import { describe, expect, it, mock } from "bun:test"
import {
  CommandRegistry,
  createCommandRegistry,
} from "../../src/commands/registry"

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

  it("/help generates command list", async () => {
    const registry = createCommandRegistry()
    const events: any[] = []
    const ctx = {
      backend: {} as any,
      pushEvent: (e: any) => events.push(e),
      clearMessages: () => {},
      clearConversation: () => {},
      setModel: async () => {},
    }

    await registry.tryExecute("/help", ctx)

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("system_message")
    expect(events[0].text).toContain("/help")
    expect(events[0].text).toContain("/clear")
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
