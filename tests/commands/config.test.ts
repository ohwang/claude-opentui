/**
 * Tests for /config slash command.
 */

import { describe, expect, it } from "bun:test"
import { configCommand } from "../../src/commands/builtin/config"
import type { CommandContext } from "../../src/commands/registry"
import type { ConfigOption } from "../../src/protocol/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockContext(options: {
  configOptions?: ConfigOption[]
  setConfigOption?: (id: string, value: unknown) => Promise<void>
} = {}): {
  ctx: CommandContext
  events: { type: string; text?: string; ephemeral?: boolean }[]
  setConfigCalls: { id: string; value: unknown }[]
} {
  const events: { type: string; text?: string; ephemeral?: boolean }[] = []
  const setConfigCalls: { id: string; value: unknown }[] = []

  const ctx: CommandContext = {
    backend: {
      start: () => (async function* () {})(),
      sendMessage: () => {},
      interrupt: () => {},
      resume: () => (async function* () {})(),
      listSessions: async () => [],
      forkSession: async () => "",
      approveToolUse: () => {},
      denyToolUse: () => {},
      respondToElicitation: () => {},
      cancelElicitation: () => {},
      setModel: async () => {},
      setPermissionMode: async () => {},
      setEffort: async () => {},
      capabilities: () => ({
        name: "test",
        supportsThinking: false,
        supportsToolApproval: false,
        supportsResume: false,
        supportsContinue: false,
        supportsFork: false,
        supportsStreaming: false,
        supportsSubagents: false,
        supportsCompact: false,
        supportedPermissionModes: ["default"],
      }),
      availableModels: async () => [],
      close: () => {},
      setConfigOption: options.setConfigOption ?? (async (id, value) => {
        setConfigCalls.push({ id, value })
      }),
    },
    pushEvent: (event: any) => events.push(event),
    clearConversation: () => {},
    resetCost: () => {},
    resetSession: async () => {},
    setModel: async () => {},
    getSessionState: () => ({
      cost: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCostUsd: 0 },
      turnNumber: 0,
      currentModel: "test-model",
      currentEffort: "high",
      session: null,
      configOptions: options.configOptions ?? [],
    }),
  }

  return { ctx, events, setConfigCalls }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("/config command", () => {
  it("shows 'no options' when no config options available", async () => {
    const { ctx, events } = createMockContext({ configOptions: [] })

    await configCommand.execute("", ctx)

    expect(events).toHaveLength(1)
    expect(events[0]!.text).toContain("No config options available")
    expect(events[0]!.ephemeral).toBe(true)
  })

  it("lists all config options with values", async () => {
    const { ctx, events } = createMockContext({
      configOptions: [
        { id: "model", name: "Model", type: "enum", value: "gemini-2.5-pro", choices: [
          { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
          { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
        ]},
        { id: "verbose", name: "Verbose", type: "boolean", value: true },
        { id: "temperature", name: "Temperature", type: "string", value: "0.7", description: "Sampling temperature" },
      ],
    })

    await configCommand.execute("", ctx)

    expect(events).toHaveLength(1)
    const text = events[0]!.text!
    expect(text).toContain("Agent Config Options")
    expect(text).toContain("model:")
    expect(text).toContain("Gemini 2.5 Pro")
    expect(text).toContain("gemini-2.5-pro|gemini-2.5-flash")
    expect(text).toContain("verbose:")
    expect(text).toContain("true")
    expect(text).toContain("(true|false)")
    expect(text).toContain("temperature:")
    expect(text).toContain("0.7")
    expect(text).toContain("Sampling temperature")
    expect(text).toContain("/config set <id> <value>")
  })

  it("/config set <id> <value> calls setConfigOption", async () => {
    const { ctx, events, setConfigCalls } = createMockContext({
      configOptions: [
        { id: "temperature", name: "Temperature", type: "string", value: "0.7" },
      ],
    })

    await configCommand.execute("set temperature 0.9", ctx)

    expect(setConfigCalls).toHaveLength(1)
    expect(setConfigCalls[0]).toEqual({ id: "temperature", value: "0.9" })
    expect(events).toHaveLength(1)
    expect(events[0]!.text).toContain("temperature set to 0.9")
  })

  it("/config set with invalid id shows error", async () => {
    const { ctx, events, setConfigCalls } = createMockContext({
      configOptions: [
        { id: "temperature", name: "Temperature", type: "string", value: "0.7" },
      ],
    })

    await configCommand.execute("set nonexistent value", ctx)

    expect(setConfigCalls).toHaveLength(0)
    expect(events).toHaveLength(1)
    expect(events[0]!.text).toContain("Unknown config option: nonexistent")
    expect(events[0]!.text).toContain("temperature")
  })

  it("/config <id> shows details for a specific option", async () => {
    const { ctx, events } = createMockContext({
      configOptions: [
        {
          id: "model",
          name: "Model",
          type: "enum",
          value: "gemini-2.5-pro",
          description: "The LLM model to use",
          choices: [
            { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
            { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
          ],
        },
      ],
    })

    await configCommand.execute("model", ctx)

    expect(events).toHaveLength(1)
    const text = events[0]!.text!
    expect(text).toContain("Config: model")
    expect(text).toContain("Name: Model")
    expect(text).toContain("Type: enum")
    expect(text).toContain("Value: Gemini 2.5 Pro (gemini-2.5-pro)")
    expect(text).toContain("The LLM model to use")
    expect(text).toContain("gemini-2.5-pro: Gemini 2.5 Pro")
    expect(text).toContain("<- current")
    expect(text).toContain("gemini-2.5-flash: Gemini 2.5 Flash")
  })

  it("/config <id> shows error for unknown option", async () => {
    const { ctx, events } = createMockContext({
      configOptions: [
        { id: "model", name: "Model", type: "enum", value: "test" },
      ],
    })

    await configCommand.execute("nonexistent", ctx)

    expect(events).toHaveLength(1)
    expect(events[0]!.text).toContain("Unknown config option: nonexistent")
    expect(events[0]!.text).toContain("model")
  })

  describe("boolean coercion", () => {
    const boolOption: ConfigOption = {
      id: "verbose",
      name: "Verbose",
      type: "boolean",
      value: false,
    }

    it("coerces 'true' to boolean true", async () => {
      const { ctx, setConfigCalls } = createMockContext({ configOptions: [boolOption] })
      await configCommand.execute("set verbose true", ctx)
      expect(setConfigCalls[0]!.value).toBe(true)
    })

    it("coerces 'false' to boolean false", async () => {
      const { ctx, setConfigCalls } = createMockContext({ configOptions: [boolOption] })
      await configCommand.execute("set verbose false", ctx)
      expect(setConfigCalls[0]!.value).toBe(false)
    })

    it("coerces '1' to boolean true", async () => {
      const { ctx, setConfigCalls } = createMockContext({ configOptions: [boolOption] })
      await configCommand.execute("set verbose 1", ctx)
      expect(setConfigCalls[0]!.value).toBe(true)
    })

    it("coerces 'yes' to boolean true", async () => {
      const { ctx, setConfigCalls } = createMockContext({ configOptions: [boolOption] })
      await configCommand.execute("set verbose yes", ctx)
      expect(setConfigCalls[0]!.value).toBe(true)
    })

    it("coerces 'no' to boolean false", async () => {
      const { ctx, setConfigCalls } = createMockContext({ configOptions: [boolOption] })
      await configCommand.execute("set verbose no", ctx)
      expect(setConfigCalls[0]!.value).toBe(false)
    })
  })

  describe("enum validation", () => {
    const enumOption: ConfigOption = {
      id: "model",
      name: "Model",
      type: "enum",
      value: "gemini-2.5-pro",
      choices: [
        { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
        { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
      ],
    }

    it("accepts valid enum choice by id", async () => {
      const { ctx, setConfigCalls } = createMockContext({ configOptions: [enumOption] })
      await configCommand.execute("set model gemini-2.5-flash", ctx)
      expect(setConfigCalls[0]!.value).toBe("gemini-2.5-flash")
    })

    it("accepts valid enum choice by name (case insensitive)", async () => {
      const { ctx, setConfigCalls } = createMockContext({ configOptions: [enumOption] })
      await configCommand.execute("set model gemini 2.5 flash", ctx)
      expect(setConfigCalls[0]!.value).toBe("gemini-2.5-flash")
    })

    it("rejects invalid enum choice", async () => {
      const { ctx, events, setConfigCalls } = createMockContext({ configOptions: [enumOption] })
      await configCommand.execute("set model invalid-model", ctx)

      expect(setConfigCalls).toHaveLength(0)
      expect(events).toHaveLength(1)
      expect(events[0]!.text).toContain("Invalid value for model")
      expect(events[0]!.text).toContain("gemini-2.5-pro")
      expect(events[0]!.text).toContain("gemini-2.5-flash")
    })
  })

  it("shows error when setConfigOption fails", async () => {
    const { ctx, events } = createMockContext({
      configOptions: [
        { id: "temperature", name: "Temperature", type: "string", value: "0.7" },
      ],
      setConfigOption: async () => { throw new Error("Server rejected") },
    })

    await configCommand.execute("set temperature 2.0", ctx)

    expect(events).toHaveLength(1)
    expect(events[0]!.text).toContain("Failed to set temperature")
    expect(events[0]!.text).toContain("Server rejected")
  })

  it("has correct metadata", () => {
    expect(configCommand.name).toBe("config")
    expect(configCommand.aliases).toContain("settings")
    expect(configCommand.argumentHint).toBe("[set <id> <value>]")
  })
})
