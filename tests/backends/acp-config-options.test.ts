import { describe, expect, it } from "bun:test"
import { AcpAdapter } from "../../src/backends/acp/adapter"
import { EventChannel } from "../../src/utils/event-channel"
import type { AgentEvent } from "../../src/protocol/types"
import type { AcpConfigOption } from "../../src/backends/acp/types"

// ---------------------------------------------------------------------------
// Helpers: Access private internals for testing
// ---------------------------------------------------------------------------

/** Create an AcpAdapter with an eventChannel wired up (no real transport). */
function createTestAdapter(): {
  adapter: AcpAdapter
  events: AgentEvent[]
} {
  const adapter = new AcpAdapter({
    command: "echo",
    args: [],
    displayName: "Test ACP Agent",
    presetName: "test-acp",
  })

  // Wire up an eventChannel so events can be pushed without start()
  const channel = new EventChannel<AgentEvent>()
  const events: AgentEvent[] = []

  // Intercept pushes by wrapping the channel
  const originalPush = channel.push.bind(channel)
  channel.push = (item: AgentEvent) => {
    events.push(item)
    originalPush(item)
  }

  // Inject the channel into the adapter's protected field
  ;(adapter as any).eventChannel = channel

  return { adapter, events }
}

/** Call the private handleNotification method */
function callHandleNotification(
  adapter: AcpAdapter,
  method: string,
  params: unknown,
): void {
  ;(adapter as any).handleNotification(method, params)
}

/** Set private discoveredConfigOptions */
function setConfigOptions(
  adapter: AcpAdapter,
  options: AcpConfigOption[],
): void {
  ;(adapter as any).discoveredConfigOptions = options
}

/** Get private discoveredConfigOptions */
function getConfigOptions(adapter: AcpAdapter): AcpConfigOption[] {
  return (adapter as any).discoveredConfigOptions
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ACP Config Options", () => {
  describe("type definitions", () => {
    it("AcpConfigOption compiles with all fields", () => {
      const option: AcpConfigOption = {
        id: "model",
        name: "Model",
        description: "The model to use",
        type: "enum",
        value: "gemini-2.5-pro",
        options: [
          { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
          { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", description: "Fast model" },
        ],
      }
      expect(option.id).toBe("model")
      expect(option.options).toHaveLength(2)
    })

    it("AcpConfigOption compiles with minimal fields", () => {
      const option: AcpConfigOption = {
        id: "verbose",
        name: "Verbose",
        type: "boolean",
        value: true,
      }
      expect(option.type).toBe("boolean")
      expect(option.description).toBeUndefined()
      expect(option.options).toBeUndefined()
    })
  })

  describe("config_option_update notification — model", () => {
    it("maps model config option to model_changed event", () => {
      const { adapter, events } = createTestAdapter()

      callHandleNotification(adapter, "config_option_update", {
        configOption: {
          id: "model",
          name: "Model",
          type: "enum",
          value: "gemini-2.5-flash",
        },
      })

      // config_options event is emitted first, then model_changed
      const nonConfig = events.filter(e => e.type !== "config_options")
      expect(nonConfig).toHaveLength(1)
      expect(nonConfig[0]).toEqual({
        type: "model_changed",
        model: "gemini-2.5-flash",
      })

      adapter.close()
    })

    it("matches model by name containing 'model' (case insensitive)", () => {
      const { adapter, events } = createTestAdapter()

      callHandleNotification(adapter, "config_option_update", {
        configOption: {
          id: "llm_model_selection",
          name: "AI Model Selection",
          type: "enum",
          value: "gpt-4o",
        },
      })

      const nonConfig = events.filter(e => e.type !== "config_options")
      expect(nonConfig).toHaveLength(1)
      expect(nonConfig[0]).toEqual({
        type: "model_changed",
        model: "gpt-4o",
      })

      adapter.close()
    })

    it("updates currentModel on the adapter", () => {
      const { adapter } = createTestAdapter()

      callHandleNotification(adapter, "config_option_update", {
        configOption: {
          id: "model",
          name: "Model",
          type: "enum",
          value: "gemini-2.5-pro",
        },
      })

      expect((adapter as any).currentModel).toBe("gemini-2.5-pro")

      adapter.close()
    })
  })

  describe("config_option_update notification — thinking/effort", () => {
    it("maps thinking config option to effort_changed event", () => {
      const { adapter, events } = createTestAdapter()

      callHandleNotification(adapter, "config_option_update", {
        configOption: {
          id: "thinking",
          name: "Thinking",
          type: "enum",
          value: "high",
        },
      })

      const nonConfig = events.filter(e => e.type !== "config_options")
      expect(nonConfig).toHaveLength(1)
      expect(nonConfig[0]).toEqual({
        type: "effort_changed",
        effort: "high",
      })

      adapter.close()
    })

    it("matches effort by name containing 'effort'", () => {
      const { adapter, events } = createTestAdapter()

      callHandleNotification(adapter, "config_option_update", {
        configOption: {
          id: "reasoning_config",
          name: "Reasoning Effort Level",
          type: "enum",
          value: "low",
        },
      })

      const nonConfig = events.filter(e => e.type !== "config_options")
      expect(nonConfig).toHaveLength(1)
      expect(nonConfig[0]).toEqual({
        type: "effort_changed",
        effort: "low",
      })

      adapter.close()
    })

    it("matches effort by name containing 'thinking'", () => {
      const { adapter, events } = createTestAdapter()

      callHandleNotification(adapter, "config_option_update", {
        configOption: {
          id: "reasoning",
          name: "Extended Thinking",
          type: "enum",
          value: "max",
        },
      })

      const nonConfig = events.filter(e => e.type !== "config_options")
      expect(nonConfig).toHaveLength(1)
      expect(nonConfig[0]).toEqual({
        type: "effort_changed",
        effort: "max",
      })

      adapter.close()
    })

    it("ignores invalid effort values", () => {
      const { adapter, events } = createTestAdapter()

      callHandleNotification(adapter, "config_option_update", {
        configOption: {
          id: "thinking",
          name: "Thinking",
          type: "enum",
          value: "ultra", // not a valid EffortLevel
        },
      })

      // Should only emit config_options (no effort_changed since value is invalid)
      const nonConfig = events.filter(e => e.type !== "config_options")
      expect(nonConfig).toHaveLength(0)

      adapter.close()
    })
  })

  describe("config_option_update notification — unknown options", () => {
    it("passes unknown config options through as backend_specific", () => {
      const { adapter, events } = createTestAdapter()

      callHandleNotification(adapter, "config_option_update", {
        configOption: {
          id: "temperature",
          name: "Temperature",
          type: "string",
          value: "0.7",
        },
      })

      const nonConfig = events.filter(e => e.type !== "config_options")
      expect(nonConfig).toHaveLength(1)
      expect(nonConfig[0]).toMatchObject({
        type: "backend_specific",
        backend: "acp",
        data: {
          type: "config_option_update",
          option: {
            id: "temperature",
            name: "Temperature",
            value: "0.7",
          },
        },
      })

      adapter.close()
    })
  })

  describe("config_option_update — stored options tracking", () => {
    it("updates existing config option in discoveredConfigOptions", () => {
      const { adapter } = createTestAdapter()

      setConfigOptions(adapter, [
        { id: "model", name: "Model", type: "enum", value: "gemini-2.5-pro" },
      ])

      callHandleNotification(adapter, "config_option_update", {
        configOption: {
          id: "model",
          name: "Model",
          type: "enum",
          value: "gemini-2.5-flash",
        },
      })

      const options = getConfigOptions(adapter)
      expect(options).toHaveLength(1)
      expect(options[0]!.value).toBe("gemini-2.5-flash")

      adapter.close()
    })

    it("appends new config option to discoveredConfigOptions", () => {
      const { adapter } = createTestAdapter()

      setConfigOptions(adapter, [
        { id: "model", name: "Model", type: "enum", value: "gemini-2.5-pro" },
      ])

      callHandleNotification(adapter, "config_option_update", {
        configOption: {
          id: "temperature",
          name: "Temperature",
          type: "string",
          value: "0.5",
        },
      })

      const options = getConfigOptions(adapter)
      expect(options).toHaveLength(2)
      expect(options[1]!.id).toBe("temperature")

      adapter.close()
    })
  })

  describe("config_option_update — edge cases", () => {
    it("ignores notification with missing configOption", () => {
      const { adapter, events } = createTestAdapter()

      callHandleNotification(adapter, "config_option_update", {})

      expect(events).toHaveLength(0)

      adapter.close()
    })

    it("ignores notification with null params", () => {
      const { adapter, events } = createTestAdapter()

      callHandleNotification(adapter, "config_option_update", null)

      expect(events).toHaveLength(0)

      adapter.close()
    })
  })

  describe("setModel — without transport", () => {
    it("throws when no transport is connected", async () => {
      const { adapter, events } = createTestAdapter()

      // No transport set up — setModel should throw
      await expect(adapter.setModel("gemini-2.5-flash")).rejects.toThrow("No active ACP session")

      // No events should be emitted
      expect(events).toHaveLength(0)

      adapter.close()
    })
  })

  describe("setModel — config option strategy", () => {
    it("uses config option when a model config option is discovered", async () => {
      const { adapter, events } = createTestAdapter()

      // Inject config options with a model option
      setConfigOptions(adapter, [
        {
          id: "model",
          name: "Model",
          type: "enum",
          value: "gemini-2.5-pro",
          options: [
            { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
            { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
          ],
        },
      ])

      // Create a mock transport
      const requestedMethods: string[] = []
      let requestedParams: unknown = null
      ;(adapter as any).transport = {
        isAlive: true,
        request: async (method: string, params: unknown) => {
          requestedMethods.push(method)
          requestedParams = params
          return {}
        },
        notify() {},
        close() {},
      }
      ;(adapter as any).sessionId = "test-session"

      await adapter.setModel("gemini-2.5-flash")

      // Should have used session/set_config_option
      expect(requestedMethods).toEqual(["session/set_config_option"])
      expect(requestedParams).toMatchObject({
        sessionId: "test-session",
        configOptionId: "model",
        value: "gemini-2.5-flash",
      })

      // Should emit model_changed
      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
        type: "model_changed",
        model: "gemini-2.5-flash",
      })

      adapter.close()
    })
  })

  describe("setModel — fallback to session/set_model", () => {
    it("falls back to session/set_model when no config option exists", async () => {
      const { adapter, events } = createTestAdapter()

      // No config options — empty array
      setConfigOptions(adapter, [])

      const requestedMethods: string[] = []
      ;(adapter as any).transport = {
        isAlive: true,
        request: async (method: string, _params: unknown) => {
          requestedMethods.push(method)
          return {}
        },
        notify() {},
        close() {},
      }
      ;(adapter as any).sessionId = "test-session"

      await adapter.setModel("gemini-2.5-flash")

      // Should have fallen back to session/set_model
      expect(requestedMethods).toEqual(["session/set_model"])

      // Should emit model_changed
      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
        type: "model_changed",
        model: "gemini-2.5-flash",
      })

      adapter.close()
    })

    it("falls back when config option request fails", async () => {
      const { adapter, events } = createTestAdapter()

      setConfigOptions(adapter, [
        { id: "model", name: "Model", type: "enum", value: "old-model" },
      ])

      const requestedMethods: string[] = []
      ;(adapter as any).transport = {
        isAlive: true,
        request: async (method: string, _params: unknown) => {
          requestedMethods.push(method)
          if (method === "session/set_config_option") {
            throw new Error("Not supported")
          }
          return {}
        },
        notify() {},
        close() {},
      }
      ;(adapter as any).sessionId = "test-session"

      await adapter.setModel("new-model")

      // Should have tried config option first, then fallen back
      expect(requestedMethods).toEqual([
        "session/set_config_option",
        "session/set_model",
      ])

      // Should emit model_changed from the fallback
      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
        type: "model_changed",
        model: "new-model",
      })

      adapter.close()
    })

    it("emits no event when both strategies fail", async () => {
      const { adapter, events } = createTestAdapter()

      setConfigOptions(adapter, [])

      ;(adapter as any).transport = {
        isAlive: true,
        request: async (_method: string, _params: unknown) => {
          throw new Error("Not supported")
        },
        notify() {},
        close() {},
      }
      ;(adapter as any).sessionId = "test-session"

      await expect(adapter.setModel("unsupported-model")).rejects.toThrow(
        "Model switching not supported by this ACP agent",
      )

      // No model_changed event should be emitted
      expect(events).toHaveLength(0)

      adapter.close()
    })
  })

  describe("capabilities", () => {
    it("reports acp capabilities", () => {
      const adapter = new AcpAdapter({
        command: "echo",
        args: [],
        displayName: "Test",
        presetName: "test-acp",
      })
      const caps = adapter.capabilities()

      expect(caps.name).toBe("test-acp")
      expect(caps.supportsToolApproval).toBe(true)
      expect(caps.supportsStreaming).toBe(true)

      adapter.close()
    })
  })

  describe("system prompt support", () => {
    /** Set private config */
    function setConfig(adapter: AcpAdapter, config: Record<string, unknown>): void {
      ;(adapter as any).config = config
    }

    /** Get private systemPromptApplied */
    function getSystemPromptApplied(adapter: AcpAdapter): boolean {
      return (adapter as any).systemPromptApplied
    }

    describe("applySystemPromptViaConfigOption", () => {
      it("sets system prompt via matching config option", async () => {
        const { adapter } = createTestAdapter()

        setConfig(adapter, { systemPrompt: "You are a test agent" })
        setConfigOptions(adapter, [
          { id: "system_prompt", name: "System Prompt", type: "string", value: "" },
        ])

        const requestedMethods: string[] = []
        let requestedParams: unknown = null
        ;(adapter as any).transport = {
          isAlive: true,
          request: async (method: string, params: unknown) => {
            requestedMethods.push(method)
            requestedParams = params
            return {}
          },
          notify() {},
          close() {},
        }
        ;(adapter as any).sessionId = "test-session"

        await (adapter as any).applySystemPromptViaConfigOption()

        expect(requestedMethods).toEqual(["session/set_config_option"])
        expect(requestedParams).toMatchObject({
          sessionId: "test-session",
          configOptionId: "system_prompt",
          value: "You are a test agent",
        })
        expect(getSystemPromptApplied(adapter)).toBe(true)

        adapter.close()
      })

      it("matches system_instruction config option id", async () => {
        const { adapter } = createTestAdapter()

        setConfig(adapter, { systemPrompt: "Be helpful" })
        setConfigOptions(adapter, [
          { id: "system_instruction", name: "Instructions", type: "string", value: "" },
        ])

        const requests: { method: string; params: any }[] = []
        ;(adapter as any).transport = {
          isAlive: true,
          request: async (method: string, params: any) => {
            requests.push({ method, params })
            return {}
          },
          notify() {},
          close() {},
        }
        ;(adapter as any).sessionId = "test-session"

        await (adapter as any).applySystemPromptViaConfigOption()

        expect(requests).toHaveLength(1)
        expect(requests[0]!.params.configOptionId).toBe("system_instruction")
        expect(getSystemPromptApplied(adapter)).toBe(true)

        adapter.close()
      })

      it("matches config option by category 'system'", async () => {
        const { adapter } = createTestAdapter()

        setConfig(adapter, { systemPrompt: "Be concise" })
        setConfigOptions(adapter, [
          { id: "persona", name: "Persona", type: "string", value: "", category: "system" },
        ])

        const requests: { method: string; params: any }[] = []
        ;(adapter as any).transport = {
          isAlive: true,
          request: async (method: string, params: any) => {
            requests.push({ method, params })
            return {}
          },
          notify() {},
          close() {},
        }
        ;(adapter as any).sessionId = "test-session"

        await (adapter as any).applySystemPromptViaConfigOption()

        expect(requests).toHaveLength(1)
        expect(requests[0]!.params.configOptionId).toBe("persona")

        adapter.close()
      })

      it("does nothing when no system prompt in config", async () => {
        const { adapter } = createTestAdapter()

        setConfig(adapter, {})
        setConfigOptions(adapter, [
          { id: "system_prompt", name: "System Prompt", type: "string", value: "" },
        ])

        ;(adapter as any).transport = {
          isAlive: true,
          request: async () => { throw new Error("should not be called") },
          notify() {},
          close() {},
        }
        ;(adapter as any).sessionId = "test-session"

        await (adapter as any).applySystemPromptViaConfigOption()

        expect(getSystemPromptApplied(adapter)).toBe(false)

        adapter.close()
      })

      it("does nothing when no matching config option exists", async () => {
        const { adapter } = createTestAdapter()

        setConfig(adapter, { systemPrompt: "Test prompt" })
        setConfigOptions(adapter, [
          { id: "model", name: "Model", type: "enum", value: "gemini-2.5-pro" },
        ])

        ;(adapter as any).transport = {
          isAlive: true,
          request: async () => { throw new Error("should not be called") },
          notify() {},
          close() {},
        }
        ;(adapter as any).sessionId = "test-session"

        await (adapter as any).applySystemPromptViaConfigOption()

        expect(getSystemPromptApplied(adapter)).toBe(false)

        adapter.close()
      })

      it("falls back gracefully when set_config_option fails", async () => {
        const { adapter } = createTestAdapter()

        setConfig(adapter, { systemPrompt: "Test prompt" })
        setConfigOptions(adapter, [
          { id: "system_prompt", name: "System Prompt", type: "string", value: "" },
        ])

        ;(adapter as any).transport = {
          isAlive: true,
          request: async () => { throw new Error("Not supported") },
          notify() {},
          close() {},
        }
        ;(adapter as any).sessionId = "test-session"

        // Should not throw
        await (adapter as any).applySystemPromptViaConfigOption()

        // systemPromptApplied should remain false so fallback injection kicks in
        expect(getSystemPromptApplied(adapter)).toBe(false)

        adapter.close()
      })
    })

    describe("sendPrompt fallback injection", () => {
      it("prepends system prompt to first user message when no config option matched", async () => {
        const { adapter } = createTestAdapter()

        setConfig(adapter, { systemPrompt: "You are a test agent" })
        // No system prompt config option — fallback should kick in

        let sentPrompt: unknown = null
        ;(adapter as any).transport = {
          isAlive: true,
          request: async (_method: string, params: any) => {
            sentPrompt = params.prompt
            return { stopReason: "end_turn" }
          },
          notify() {},
          close() {},
        }
        ;(adapter as any).sessionId = "test-session"
        ;(adapter as any).eventChannel = { push() {}, close() {} }

        await (adapter as any).sendPrompt("Hello world")

        expect(sentPrompt).toEqual([
          { type: "text", text: "[System Prompt]\nYou are a test agent\n\n[User Message]\nHello world" },
        ])
        expect(getSystemPromptApplied(adapter)).toBe(true)

        adapter.close()
      })

      it("does not prepend system prompt on second message", async () => {
        const { adapter } = createTestAdapter()

        setConfig(adapter, { systemPrompt: "You are a test agent" })

        const sentPrompts: unknown[] = []
        ;(adapter as any).transport = {
          isAlive: true,
          request: async (_method: string, params: any) => {
            sentPrompts.push(params.prompt)
            return { stopReason: "end_turn" }
          },
          notify() {},
          close() {},
        }
        ;(adapter as any).sessionId = "test-session"
        ;(adapter as any).eventChannel = { push() {}, close() {} }

        await (adapter as any).sendPrompt("First message")
        await (adapter as any).sendPrompt("Second message")

        // First message should have system prompt
        expect(sentPrompts[0]).toEqual([
          { type: "text", text: "[System Prompt]\nYou are a test agent\n\n[User Message]\nFirst message" },
        ])
        // Second message should be plain
        expect(sentPrompts[1]).toEqual([
          { type: "text", text: "Second message" },
        ])

        adapter.close()
      })

      it("does not inject when systemPromptApplied is already true (config option succeeded)", async () => {
        const { adapter } = createTestAdapter()

        setConfig(adapter, { systemPrompt: "You are a test agent" })
        ;(adapter as any).systemPromptApplied = true // Simulate config option success

        let sentPrompt: unknown = null
        ;(adapter as any).transport = {
          isAlive: true,
          request: async (_method: string, params: any) => {
            sentPrompt = params.prompt
            return { stopReason: "end_turn" }
          },
          notify() {},
          close() {},
        }
        ;(adapter as any).sessionId = "test-session"
        ;(adapter as any).eventChannel = { push() {}, close() {} }

        await (adapter as any).sendPrompt("Hello")

        expect(sentPrompt).toEqual([
          { type: "text", text: "Hello" },
        ])

        adapter.close()
      })

      it("sends plain text when no system prompt configured", async () => {
        const { adapter } = createTestAdapter()

        setConfig(adapter, {})

        let sentPrompt: unknown = null
        ;(adapter as any).transport = {
          isAlive: true,
          request: async (_method: string, params: any) => {
            sentPrompt = params.prompt
            return { stopReason: "end_turn" }
          },
          notify() {},
          close() {},
        }
        ;(adapter as any).sessionId = "test-session"
        ;(adapter as any).eventChannel = { push() {}, close() {} }

        await (adapter as any).sendPrompt("Hello")

        expect(sentPrompt).toEqual([
          { type: "text", text: "Hello" },
        ])

        adapter.close()
      })
    })
  })
})
