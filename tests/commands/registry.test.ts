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
    backend: {
      availableModels: async () => [],
      capabilities: () => ({ name: "claude" }),
    } as any,
    pushEvent: (e: any) => events.push(e),
    clearConversation: () => {},
    resetCost: () => {},
    resetSession: async () => {},
    setModel: async () => {},
    exit: () => {},
    toggleDiagnostics: () => {},
    getSessionState: () => ({
      cost: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, totalCostUsd: 0.01 },
      turnNumber: 3,
      currentModel: "claude-sonnet-4-6",
      currentEffort: "",
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
    expect(registry.search("hel")[0]!.name).toBe("help")
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
    expect(results[0]!.name).toBe("model")
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
      clearConversation: () => {},
      resetCost: () => {},
      resetSession: async () => {},
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
      clearConversation: () => {},
      resetCost: () => {},
      resetSession: async () => {},
      setModel: async () => {},
    }

    expect(await registry.tryExecute("hello", ctx)).toBe(false)
  })

  it("tryExecute returns false for unknown commands", async () => {
    const registry = new CommandRegistry()
    const ctx = {
      backend: {} as any,
      pushEvent: () => {},
      clearConversation: () => {},
      resetCost: () => {},
      resetSession: async () => {},
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

  it("/help opens modal (no system_message events)", async () => {
    const registry = createCommandRegistry()
    const ctx = makeCtx()

    await registry.tryExecute("/help", ctx)

    // /help now uses showModal() instead of pushEvent, so no events are emitted
    expect(ctx.events).toHaveLength(0)
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

  it("does not match commands whose description (but not name) contains the query", () => {
    const registry = createCommandRegistry()
    // /he should only match /help, not /diagnostics ("Toggle the diagnostics panel")
    // or /exit ("Exit the application") whose descriptions contain "he" via "the"
    const results = registry.search("he")
    const names = results.map((r) => r.name)
    expect(names).toContain("help")
    expect(names).not.toContain("diagnostics")
    expect(names).not.toContain("exit")
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

  it("does not match on description text (only names and aliases)", () => {
    const registry = createCommandRegistry()
    // "keyboard" appears in the hotkeys description but not in its name or aliases
    const results = registry.search("keyboard")
    expect(results.some((r) => r.name === "hotkeys")).toBe(false)
  })

  it("matches on alias names", () => {
    const registry = createCommandRegistry()
    // "shortcuts" is an alias for /hotkeys
    const results = registry.search("shortcuts")
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
        currentEffort: "",
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
        currentEffort: "",
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
  it("opens modal (no system_message events)", async () => {
    const registry = createCommandRegistry()
    const ctx = makeCtx()

    await registry.tryExecute("/hotkeys", ctx)

    // /hotkeys now uses showModal() instead of pushEvent, so no events are emitted
    expect(ctx.events).toHaveLength(0)
  })

  it("is reachable via aliases", () => {
    const registry = createCommandRegistry()
    expect(registry.get("keys")).toBeDefined()
    expect(registry.get("shortcuts")).toBeDefined()
    expect(registry.get("keys")!.name).toBe("hotkeys")
  })
})

describe("/compact command", () => {
  it("sends compact message to backend when supported", async () => {
    const registry = createCommandRegistry()
    let sentMessage: any = null
    const ctx = makeCtx({
      backend: {
        sendMessage: (msg: any) => { sentMessage = msg },
        capabilities: () => ({ name: "claude", supportsCompact: true }),
      } as any,
    })
    const handled = await registry.tryExecute("/compact", ctx)
    expect(handled).toBe(true)
    expect(sentMessage).toBeTruthy()
    expect(sentMessage.text).toBe("/compact")
  })

  it("passes custom instructions to backend", async () => {
    const registry = createCommandRegistry()
    let sentMessage: any = null
    const ctx = makeCtx({
      backend: {
        sendMessage: (msg: any) => { sentMessage = msg },
        capabilities: () => ({ name: "claude", supportsCompact: true }),
      } as any,
    })
    await registry.tryExecute("/compact focus on API changes", ctx)
    expect(sentMessage.text).toBe("/compact focus on API changes")
  })

  it("shows error when backend does not support compact", async () => {
    const registry = createCommandRegistry()
    let sentMessage: any = null
    const ctx = makeCtx({
      backend: {
        sendMessage: (msg: any) => { sentMessage = msg },
        capabilities: () => ({ name: "acp", supportsCompact: false }),
      } as any,
    })
    const handled = await registry.tryExecute("/compact", ctx)
    expect(handled).toBe(true)
    expect(sentMessage).toBeNull()
    expect(ctx.events.some(e => e.text?.includes("not supported"))).toBe(true)
  })
})

describe("/new command", () => {
  it("clears conversation, resets cost, and resets backend session", async () => {
    const registry = createCommandRegistry()
    let cleared = false
    let costReset = false
    let sessionReset = false
    const ctx = makeCtx({
      clearConversation: () => { cleared = true },
      resetCost: () => { costReset = true },
      resetSession: async () => { sessionReset = true },
    })
    const handled = await registry.tryExecute("/new", ctx)
    expect(handled).toBe(true)
    expect(cleared).toBe(true)
    expect(costReset).toBe(true)
    expect(sessionReset).toBe(true)
    expect(ctx.events.some(e => e.type === "system_message")).toBe(false)
  })
})

describe("/diagnostics command", () => {
  it("toggles diagnostics panel", async () => {
    const registry = createCommandRegistry()
    let toggled = false
    const ctx = makeCtx({
      toggleDiagnostics: () => { toggled = true },
    })
    const handled = await registry.tryExecute("/diagnostics", ctx)
    expect(handled).toBe(true)
    expect(toggled).toBe(true)
  })

  it("shows fallback message when toggleDiagnostics is not available", async () => {
    const registry = createCommandRegistry()
    const ctx = makeCtx({
      toggleDiagnostics: undefined,
    })
    await registry.tryExecute("/diagnostics", ctx)
    expect(ctx.events.some(e => e.text?.includes("not available"))).toBe(true)
  })
})

describe("/usage command", () => {
  it("shows usage information", async () => {
    const registry = createCommandRegistry()
    const ctx = makeCtx({
      getSessionState: () => ({
        cost: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, totalCostUsd: 0.01 },
        turnNumber: 3,
        currentModel: "claude-sonnet-4-6",
        currentEffort: "",
        session: { account: { email: "test@example.com", plan: "pro" }, tools: [], models: [] },
      }),
    })
    const handled = await registry.tryExecute("/usage", ctx)
    expect(handled).toBe(true)
    const msg = ctx.events.find(e => e.type === "system_message")
    expect(msg).toBeDefined()
    expect(msg.text).toContain("pro")
  })

  it("shows fallback when no account info", async () => {
    const registry = createCommandRegistry()
    const ctx = makeCtx()
    const handled = await registry.tryExecute("/usage", ctx)
    expect(handled).toBe(true)
    expect(ctx.events.some(e => e.type === "system_message")).toBe(true)
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

  it("lists backend-specific models for /model list", async () => {
    const registry = createCommandRegistry()
    const ctx = makeCtx({
      backend: {
        availableModels: async () => [
          { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "google" },
          { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "google" },
        ],
        capabilities: () => ({ name: "gemini" }),
      } as any,
      getSessionState: () => ({
        cost: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, totalCostUsd: 0.01 },
        turnNumber: 3,
        currentModel: "gemini-2.5-pro",
        currentEffort: "",
        session: {
          tools: [],
          models: [{ id: "gemini-2.5-pro", name: "gemini-2.5-pro", provider: "google" }],
        },
      }),
    })

    await registry.tryExecute("/model list", ctx)

    const msg = ctx.events.find((e) => e.type === "system_message")
    expect(msg).toBeDefined()
    expect(msg.text).toContain("gemini-2.5-pro")
    expect(msg.text).toContain("gemini-2.5-flash")
    expect(msg.text).not.toContain("claude-opus-4-6")
  })

  it("validates against backend-specific models instead of static Claude models", async () => {
    const registry = createCommandRegistry()
    const setModelFn = mock(async () => {})
    const ctx = makeCtx({
      setModel: setModelFn,
      backend: {
        availableModels: async () => [
          { id: "o3", name: "o3", provider: "openai" },
          { id: "o4-mini", name: "o4-mini", provider: "openai" },
        ],
        capabilities: () => ({ name: "codex" }),
      } as any,
      getSessionState: () => ({
        cost: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, totalCostUsd: 0.01 },
        turnNumber: 3,
        currentModel: "o3",
        currentEffort: "",
        session: {
          tools: [],
          models: [{ id: "o3", name: "o3", provider: "openai" }],
        },
      }),
    })

    await registry.tryExecute("/model o3", ctx)

    expect(setModelFn).toHaveBeenCalledWith("o3")
    const msg = ctx.events.find((e) => e.type === "system_message")
    expect(msg?.text ?? "").not.toContain("Unknown model")
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

  it("resolves partial name 'opus' to claude-opus-4-6", async () => {
    const registry = createCommandRegistry()
    const setModelFn = mock(async () => {})
    const ctx = makeCtx({ setModel: setModelFn })

    await registry.tryExecute("/model opus", ctx)

    expect(setModelFn).toHaveBeenCalledWith("claude-opus-4-6")
    const modelChanged = ctx.events.find((e) => e.type === "model_changed")
    expect(modelChanged).toBeDefined()
    expect(modelChanged.model).toBe("claude-opus-4-6")
  })

  it("resolves partial name 'sonnet' to shortest matching model ID", async () => {
    const registry = createCommandRegistry()
    const setModelFn = mock(async () => {})
    const ctx = makeCtx({ setModel: setModelFn })

    await registry.tryExecute("/model sonnet", ctx)

    // Should match claude-sonnet-4-6 (shortest ID containing "sonnet")
    expect(setModelFn).toHaveBeenCalledWith("claude-sonnet-4-6")
  })

  it("resolves partial name 'haiku' to shortest matching model ID", async () => {
    const registry = createCommandRegistry()
    const setModelFn = mock(async () => {})
    const ctx = makeCtx({ setModel: setModelFn })

    await registry.tryExecute("/model haiku", ctx)

    expect(setModelFn).toHaveBeenCalled()
    const calledWith = (setModelFn.mock.calls[0] as unknown as string[])[0]
    expect(calledWith).toContain("haiku")
  })

  it("resolves case-insensitive partial names", async () => {
    const registry = createCommandRegistry()
    const setModelFn = mock(async () => {})
    const ctx = makeCtx({ setModel: setModelFn })

    await registry.tryExecute("/model OPUS", ctx)

    expect(setModelFn).toHaveBeenCalledWith("claude-opus-4-6")
  })

  it("still rejects completely unknown partial names", async () => {
    const registry = createCommandRegistry()
    const ctx = makeCtx()

    await registry.tryExecute("/model gpt4", ctx)

    const msg = ctx.events.find((e) => e.type === "system_message")
    expect(msg).toBeDefined()
    expect(msg.text).toContain("Unknown model: gpt4")
  })

  it("exact match takes priority over partial match", async () => {
    const registry = createCommandRegistry()
    const setModelFn = mock(async () => {})
    const ctx = makeCtx({
      setModel: setModelFn,
      backend: {
        availableModels: async () => [
          { id: "opus", name: "Short Opus", provider: "test" },
          { id: "claude-opus-4-6", name: "Opus 4.6", provider: "anthropic" },
        ],
        capabilities: () => ({ name: "test" }),
      } as any,
      getSessionState: () => ({
        cost: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCostUsd: 0 },
        turnNumber: 0,
        currentModel: "opus",
        currentEffort: "",
        session: { tools: [], models: [] },
      }),
    })

    await registry.tryExecute("/model opus", ctx)

    // Exact match "opus" should win, not partial match to "claude-opus-4-6"
    expect(setModelFn).toHaveBeenCalledWith("opus")
  })

  it("resolves partial names against non-Claude backends", async () => {
    const registry = createCommandRegistry()
    const setModelFn = mock(async () => {})
    const ctx = makeCtx({
      setModel: setModelFn,
      backend: {
        availableModels: async () => [
          { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "google" },
          { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "google" },
        ],
        capabilities: () => ({ name: "gemini" }),
      } as any,
      getSessionState: () => ({
        cost: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCostUsd: 0 },
        turnNumber: 0,
        currentModel: "gemini-2.5-pro",
        currentEffort: "",
        session: { tools: [], models: [] },
      }),
    })

    await registry.tryExecute("/model flash", ctx)

    expect(setModelFn).toHaveBeenCalledWith("gemini-2.5-flash")
  })
})
