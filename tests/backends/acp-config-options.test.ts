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

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
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

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
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

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
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

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
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

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
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

      // Should not emit any event (invalid value silently dropped)
      expect(events).toHaveLength(0)

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

      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
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
    it("returns silently when no transport is connected", async () => {
      const { adapter, events } = createTestAdapter()

      // No transport set up — setModel should bail early
      await adapter.setModel("gemini-2.5-flash")

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
        close() {},
      }
      ;(adapter as any).sessionId = "test-session"

      await adapter.setModel("unsupported-model")

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
})
