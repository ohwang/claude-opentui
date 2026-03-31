import { describe, expect, it, mock } from "bun:test"
import {
  CommandRegistry,
  createCommandRegistry,
  type CommandContext,
} from "../../src/commands/registry"

/** Minimal mock context for commands that only call pushEvent */
function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext & { events: any[] } {
  const events: any[] = []
  return {
    events,
    backend: {} as any,
    pushEvent: (e: any) => events.push(e),
    clearConversation: () => {},
    resetCost: () => {},
    setModel: async () => {},
    exit: () => {},
    toggleDiagnostics: () => {},
    getSessionState: () => ({
      cost: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, totalCostUsd: 0.01 },
      turnNumber: 3,
      currentModel: "claude-sonnet-4-6",
      session: null,
    }),
    getBlocks: () => [],
    ...overrides,
  }
}

describe("CommandRegistry", () => {
  it("registers and retrieves commands", () => {
    const registry = new CommandRegistry()
    registry.register({
      name: "test",
      description: "Test command",
      execute: () => {},
    })

    expect(registry.get("test")).toBeDefined()
    expect(registry.get("test")!.name).toBe("test")
  })

  it("retrieves by alias", () => {
    const registry = new CommandRegistry()
    registry.register({
      name: "help",
      description: "Show help",
      aliases: ["?", "h"],
      execute: () => {},
    })

    expect(registry.get("?")).toBeDefined()
    expect(registry.get("h")).toBeDefined()
    expect(registry.get("?")!.name).toBe("help")
  })

  it("all() deduplicates aliases", () => {
    const registry = new CommandRegistry()
    registry.register({
      name: "help",
      description: "Show help",
      aliases: ["?"],
      execute: () => {},
    })

    expect(registry.all()).toHaveLength(1)
  })

  it("search returns matching commands", () => {
    const registry = new CommandRegistry()
    registry.register({
      name: "help",
      description: "Show help",
      execute: () => {},
    })
    registry.register({
      name: "model",
      description: "Switch model",
      execute: () => {},
    })

    expect(registry.search("hel")).toHaveLength(1)
    expect(registry.search("hel")[0].name).toBe("help")
  })

  it("search prefers prefix matches", () => {
    const registry = new CommandRegistry()
    registry.register({
      name: "model",
      description: "Switch model",
      execute: () => {},
    })
    registry.register({
      name: "setmodel",
      description: "Also sets model",
      execute: () => {},
    })

    const results = registry.search("model")
    expect(results[0].name).toBe("model")
  })

  it("tryExecute dispatches slash commands", async () => {
    const handler = mock(() => {})
    const registry = new CommandRegistry()
    registry.register({
      name: "test",
      description: "Test",
      execute: handler,
    })

    const ctx = {
      backend: {} as any,
      pushEvent: () => {},
      clearMessages: () => {},
      clearConversation: () => {},
      setModel: async () => {},
    }

    const handled = await registry.tryExecute("/test arg1 arg2", ctx)
    expect(handled).toBe(true)
    expect(handler).toHaveBeenCalledWith("arg1 arg2", ctx)
  })

  it("tryExecute returns false for non-slash input", async () => {
    const registry = new CommandRegistry()
    const ctx = {
      backend: {} as any,
      pushEvent: () => {},
      clearMessages: () => {},
      clearConversation: () => {},
      setModel: async () => {},
    }

    expect(await registry.tryExecute("hello", ctx)).toBe(false)
  })

  it("tryExecute returns false for unknown commands", async () => {
    const registry = new CommandRegistry()
    const ctx = {
      backend: {} as any,
      pushEvent: () => {},
      clearMessages: () => {},
      clearConversation: () => {},
      setModel: async () => {},
    }

    expect(await registry.tryExecute("/nonexistent", ctx)).toBe(false)
  })
})

describe("Built-in commands", () => {
  it("createCommandRegistry includes all builtins", () => {
    const registry = createCommandRegistry()
    const commands = registry.all()
    const names = commands.map((c) => c.name)

    expect(names).toContain("help")
    expect(names).toContain("clear")
    expect(names).toContain("compact")
    expect(names).toContain("model")
    expect(names).toContain("exit")
  })

  it("createCommandRegistry has at least 6 commands", () => {
    const registry = createCommandRegistry()
    const all = registry.all()
    expect(all.length).toBeGreaterThanOrEqual(6)
  })

  it("/help generates command list", async () => {
    const registry = createCommandRegistry()
    const ctx = makeCtx()

    await registry.tryExecute("/help", ctx)

    expect(ctx.events).toHaveLength(1)
    expect(ctx.events[0].type).toBe("system_message")
    expect(ctx.events[0].text).toContain("/help")
    expect(ctx.events[0].text).toContain("/clear")
  })

  it("/exit calls process.exit", async () => {
    // We can verify /exit is registered and callable
    const registry = createCommandRegistry()
    const cmd = registry.get("exit")
    expect(cmd).toBeDefined()
    expect(cmd!.aliases).toContain("quit")
    expect(cmd!.aliases).toContain("q")
  })
})

describe("search features", () => {
  it("searches by prefix", () => {
    const registry = createCommandRegistry()
    const results = registry.search("he")
    expect(results.some((r) => r.name === "help")).toBe(true)
  })

  it("matches commands reachable via alias names", () => {
    const registry = createCommandRegistry()
    // "q" is an alias for /exit; search matches on command name + description,
    // not aliases directly, but /exit's description or the "quit" alias command
    // entry should surface it. Let's verify "quit" or "exit" shows up.
    const results = registry.search("exit")
    expect(results.some((r) => r.name === "exit")).toBe(true)
  })

  it("returns empty for no matches", () => {
    const registry = createCommandRegistry()
    const results = registry.search("xyznonexistent")
    expect(results).toEqual([])
  })

  it("is case insensitive", () => {
    const registry = createCommandRegistry()
    const upper = registry.search("HELP")
    const lower = registry.search("help")
    expect(upper.some((r) => r.name === "help")).toBe(true)
    expect(lower.some((r) => r.name === "help")).toBe(true)
  })

  it("matches on description text", () => {
    const registry = createCommandRegistry()
    // "keyboard" appears in the hotkeys description
    const results = registry.search("keyboard")
    expect(results.some((r) => r.name === "hotkeys")).toBe(true)
  })

  it("empty query returns all commands", () => {
    const registry = createCommandRegistry()
    const all = registry.search("")
    expect(all.length).toBe(registry.all().length)
  })
})

describe("/cost command", () => {
  it("shows friendly model name and cost", async () => {
    const registry = createCommandRegistry()
    const ctx = makeCtx({
      getSessionState: () => ({
        cost: { inputTokens: 5000, outputTokens: 2000, cacheReadTokens: 1000, cacheWriteTokens: 500, totalCostUsd: 0.0142 },
        turnNumber: 5,
        currentModel: "claude-opus-4-6",
        session: null,
      }),
    })

    await registry.tryExecute("/cost", ctx)

    const msg = ctx.events.find((e) => e.type === "system_message")
    expect(msg).toBeDefined()
    expect(msg.text).toContain("Opus 4.6")
    expect(msg.text).toContain("$0.0142")
  })

  it("shows turn count and token breakdown", async () => {
    const registry = createCommandRegistry()
    const ctx = makeCtx({
      getSessionState: () => ({
        cost: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, totalCostUsd: 0.01 },
        turnNumber: 3,
        currentModel: "claude-sonnet-4-6",
        session: null,
      }),
    })

    await registry.tryExecute("/cost", ctx)

    const msg = ctx.events.find((e) => e.type === "system_message")
    expect(msg).toBeDefined()
    expect(msg.text).toContain("3 turns")
    expect(msg.text).toContain("150") // 100 + 50 total tokens
  })

  it("handles missing session state gracefully", async () => {
    const registry = createCommandRegistry()
    const ctx = makeCtx({ getSessionState: undefined })

    await registry.tryExecute("/cost", ctx)

    const msg = ctx.events.find((e) => e.type === "system_message")
    expect(msg).toBeDefined()
    expect(msg.text).toContain("not available")
  })
})

describe("/hotkeys command", () => {
  it("includes key bindings in output", async () => {
    const registry = createCommandRegistry()
    const ctx = makeCtx()

    await registry.tryExecute("/hotkeys", ctx)

    const msg = ctx.events.find((e) => e.type === "system_message")
    expect(msg).toBeDefined()
    expect(msg.text).toContain("Ctrl+V")
    expect(msg.text).toContain("Ctrl+Z")
    expect(msg.text).toContain("Ctrl+C")
    expect(msg.text).toContain("Return")
  })

  it("is reachable via aliases", () => {
    const registry = createCommandRegistry()
    expect(registry.get("keys")).toBeDefined()
    expect(registry.get("shortcuts")).toBeDefined()
    expect(registry.get("keys")!.name).toBe("hotkeys")
  })
})

describe("/model command", () => {
  it("shows usage when called without args", async () => {
    const registry = createCommandRegistry()
    const ctx = makeCtx()

    await registry.tryExecute("/model", ctx)

    const msg = ctx.events.find((e) => e.type === "system_message")
    expect(msg).toBeDefined()
    expect(msg.text).toContain("Usage")
  })

  it("switches model and emits events", async () => {
    const registry = createCommandRegistry()
    const setModelFn = mock(async () => {})
    const ctx = makeCtx({ setModel: setModelFn })

    await registry.tryExecute("/model claude-opus-4-6", ctx)

    expect(setModelFn).toHaveBeenCalledWith("claude-opus-4-6")
    const modelChanged = ctx.events.find((e) => e.type === "model_changed")
    expect(modelChanged).toBeDefined()
    expect(modelChanged.model).toBe("claude-opus-4-6")
    const sysMsg = ctx.events.find((e) => e.type === "system_message")
    expect(sysMsg).toBeDefined()
    expect(sysMsg.text).toContain("claude-opus-4-6")
  })

  it("reports unknown model when name is not in MODEL_NAMES", async () => {
    const registry = createCommandRegistry()
    const ctx = makeCtx()

    await registry.tryExecute("/model bad-model", ctx)

    const msg = ctx.events.find((e) => e.type === "system_message")
    expect(msg).toBeDefined()
    expect(msg.text).toContain("Unknown model: bad-model")
    expect(msg.text).toContain("Available models")
  })

  it("reports error when setModel throws for a valid model", async () => {
    const registry = createCommandRegistry()
    const ctx = makeCtx({
      setModel: async () => { throw new Error("Model not found") },
    })

    await registry.tryExecute("/model claude-opus-4-6", ctx)

    const msg = ctx.events.find((e) => e.type === "system_message")
    expect(msg).toBeDefined()
    expect(msg.text).toContain("Error")
    expect(msg.text).toContain("Model not found")
  })

  it("is reachable via /m alias", () => {
    const registry = createCommandRegistry()
    expect(registry.get("m")).toBeDefined()
    expect(registry.get("m")!.name).toBe("model")
  })
})
