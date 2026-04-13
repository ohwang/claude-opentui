import { describe, expect, it } from "bun:test"
import type { AgentBackend, SessionState } from "../../src/protocol/types"
import type { CommandContext } from "../../src/commands/registry"
import { backendCommand } from "../../src/commands/builtin/backend"
import { switchCommand } from "../../src/commands/builtin/switch"

/** Tiny fake backend — only implements what the commands touch. */
function fakeBackend(name = "claude"): AgentBackend {
  return {
    capabilities: () => ({ name, supportsThinking: false, supportsToolApproval: false, supportsResume: false, supportsContinue: false, supportsFork: false, supportsStreaming: true, supportsSubagents: false, supportsCompact: false, supportedPermissionModes: ["default"] }),
  } as any
}

function makeCtx(
  opts: {
    current?: string
    sessionState?: SessionState
    currentModel?: string
    switchBackend?: CommandContext["switchBackend"]
    setModel?: CommandContext["setModel"]
  } = {},
): CommandContext & { events: any[]; switchCalls: any[] } {
  const events: any[] = []
  const switchCalls: any[] = []
  return {
    events,
    switchCalls,
    backend: fakeBackend(opts.current ?? "claude"),
    pushEvent: (e: any) => events.push(e),
    clearConversation: () => {},
    resetCost: () => {},
    resetSession: async () => {},
    setModel: opts.setModel ?? (async () => {}),
    getSessionState: () => ({
      cost: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCostUsd: 0 },
      turnNumber: 0,
      currentModel: opts.currentModel ?? "",
      currentEffort: "",
      session: null,
      sessionState: opts.sessionState ?? "IDLE",
    }),
    getBlocks: () => [],
    switchBackend: opts.switchBackend ?? (async (o: any) => { switchCalls.push(o) }),
  } as any
}

describe("/backend", () => {
  it("lists available backends with current marker", async () => {
    const ctx = makeCtx({ current: "mock" })
    await backendCommand.execute("", ctx)
    const msg = ctx.events[0]
    expect(msg.type).toBe("system_message")
    expect(msg.ephemeral).toBe(true)
    expect(msg.text).toContain("Current:")
    expect(msg.text).toContain("* mock")
    expect(msg.text).toContain("claude")
    expect(msg.text).toContain("codex")
  })
})

describe("/switch", () => {
  it("rejects an unknown backend", async () => {
    const ctx = makeCtx()
    await switchCommand.execute("bogus", ctx)
    expect(ctx.switchCalls.length).toBe(0)
    expect(ctx.events[0].text).toMatch(/Unknown backend: bogus/)
  })

  it("prints usage with no args", async () => {
    const ctx = makeCtx()
    await switchCommand.execute("", ctx)
    expect(ctx.switchCalls.length).toBe(0)
    expect(ctx.events[0].text).toMatch(/Usage: \/switch/)
  })

  it("refuses to switch while the agent is RUNNING", async () => {
    const ctx = makeCtx({ current: "claude", sessionState: "RUNNING" })
    await switchCommand.execute("mock", ctx)
    expect(ctx.switchCalls.length).toBe(0)
    expect(ctx.events[0].text).toMatch(/Cannot switch/)
  })

  it("refuses to switch during permission prompts", async () => {
    const ctx = makeCtx({ current: "claude", sessionState: "WAITING_FOR_PERM" })
    await switchCommand.execute("mock", ctx)
    expect(ctx.switchCalls.length).toBe(0)
    expect(ctx.events[0].text).toMatch(/Cannot switch/)
  })

  it("invokes switchBackend with the adapter and announces success", async () => {
    const ctx = makeCtx({ current: "claude", sessionState: "IDLE" })
    await switchCommand.execute("mock", ctx)
    expect(ctx.switchCalls.length).toBe(1)
    expect(ctx.switchCalls[0].backendId).toBe("mock")
    expect(ctx.switchCalls[0].adapter.capabilities().name).toBe("mock")
    // Final system_message announces the switch (not ephemeral)
    const last = ctx.events[ctx.events.length - 1]
    expect(last.text).toMatch(/Switched to Mock/)
    expect(last.ephemeral).toBeFalsy()
  })

  it("passes a model arg through to switchBackend", async () => {
    const ctx = makeCtx({ current: "claude", sessionState: "IDLE" })
    await switchCommand.execute("mock claude-opus-4-6", ctx)
    expect(ctx.switchCalls[0].model).toBe("claude-opus-4-6")
    const last = ctx.events[ctx.events.length - 1]
    expect(last.text).toContain("claude-opus-4-6")
  })

  it("delegates to setModel when switching to the same backend with a model", async () => {
    let modelSet = ""
    const ctx = makeCtx({
      current: "claude",
      sessionState: "IDLE",
      setModel: async (m: string) => { modelSet = m },
    })
    await switchCommand.execute("claude claude-opus-4-6", ctx)
    expect(modelSet).toBe("claude-opus-4-6")
    expect(ctx.switchCalls.length).toBe(0)
    const last = ctx.events[ctx.events.length - 1]
    expect(last.text).toMatch(/Already on Claude/)
  })

  it("surfaces switchBackend failures without a stray adapter leak", async () => {
    const ctx = makeCtx({
      current: "claude",
      sessionState: "IDLE",
      switchBackend: async () => { throw new Error("boom") },
    })
    await switchCommand.execute("mock", ctx)
    const last = ctx.events[ctx.events.length - 1]
    expect(last.text).toMatch(/Switch to mock failed: boom/)
  })

  it("refuses generic acp (requires extra launch config)", async () => {
    const ctx = makeCtx({ current: "claude", sessionState: "IDLE" })
    await switchCommand.execute("acp", ctx)
    expect(ctx.switchCalls.length).toBe(0)
    expect(ctx.events[0].text).toMatch(/acp/)
    expect(ctx.events[0].text).toMatch(/extra launch config/)
  })
})
