import { describe, expect, it } from "bun:test"
import { CodexAdapter } from "../../src/backends/codex/adapter"
import { AcpAdapter } from "../../src/backends/acp/adapter"
import { ClaudeAdapter } from "../../src/backends/claude/adapter"
import type { BackendCapabilities } from "../../src/protocol/types"

// ---------------------------------------------------------------------------
// BackendCapabilities: supportsContinue field
// ---------------------------------------------------------------------------

describe("BackendCapabilities: resume and continue support", () => {
  describe("Claude", () => {
    it("reports supportsResume true", () => {
      const adapter = new ClaudeAdapter()
      expect(adapter.capabilities().supportsResume).toBe(true)
      adapter.close()
    })

    it("reports supportsContinue true", () => {
      const adapter = new ClaudeAdapter()
      expect(adapter.capabilities().supportsContinue).toBe(true)
      adapter.close()
    })
  })

  describe("Codex", () => {
    it("reports supportsResume true", () => {
      const adapter = new CodexAdapter()
      expect(adapter.capabilities().supportsResume).toBe(true)
      adapter.close()
    })

    it("reports supportsContinue true", () => {
      const adapter = new CodexAdapter()
      expect(adapter.capabilities().supportsContinue).toBe(true)
      adapter.close()
    })
  })

  describe("ACP without loadSession", () => {
    it("reports supportsResume false when agent lacks loadSession", () => {
      const adapter = new AcpAdapter({
        command: "echo",
        args: [],
        displayName: "Test Agent",
        presetName: "test",
      })
      // Before initialize, agentCapabilities is null -> loadSession is falsy
      const caps = adapter.capabilities()
      expect(caps.supportsResume).toBe(false)
      adapter.close()
    })

    it("reports supportsContinue false when agent lacks loadSession", () => {
      const adapter = new AcpAdapter({
        command: "echo",
        args: [],
        displayName: "Test Agent",
        presetName: "test",
      })
      const caps = adapter.capabilities()
      expect(caps.supportsContinue).toBe(false)
      adapter.close()
    })
  })

  describe("ACP with loadSession", () => {
    it("reports supportsResume true when agent has loadSession", () => {
      const adapter = new AcpAdapter({
        command: "echo",
        args: [],
        displayName: "Test Agent",
        presetName: "test",
      })
      // Simulate agent capabilities being set after initialize
      ;(adapter as any).agentCapabilities = { loadSession: true }
      const caps = adapter.capabilities()
      expect(caps.supportsResume).toBe(true)
      adapter.close()
    })

    it("reports supportsContinue true when agent has loadSession", () => {
      const adapter = new AcpAdapter({
        command: "echo",
        args: [],
        displayName: "Test Agent",
        presetName: "test",
      })
      ;(adapter as any).agentCapabilities = { loadSession: true }
      const caps = adapter.capabilities()
      expect(caps.supportsContinue).toBe(true)
      adapter.close()
    })
  })
})

// ---------------------------------------------------------------------------
// BackendCapabilities interface shape
// ---------------------------------------------------------------------------

describe("BackendCapabilities interface", () => {
  it("all backends include supportsContinue in their capabilities", () => {
    const adapters = [
      new ClaudeAdapter(),
      new CodexAdapter(),
      new AcpAdapter({ command: "echo", args: [], displayName: "Test", presetName: "test" }),
    ]

    for (const adapter of adapters) {
      const caps = adapter.capabilities()
      expect(typeof caps.supportsContinue).toBe("boolean")
      expect(typeof caps.supportsResume).toBe("boolean")
      adapter.close()
    }
  })

  it("supportsContinue and supportsResume are independent properties", () => {
    // Verify both exist as separate fields, not aliases
    const caps: BackendCapabilities = {
      name: "test",
      supportsThinking: false,
      supportsToolApproval: false,
      supportsResume: true,
      supportsContinue: false,
      supportsCompact: false,
      supportsFork: false,
      supportsStreaming: false,
      supportsSubagents: false,
      supportedPermissionModes: ["default"],
    }
    expect(caps.supportsResume).toBe(true)
    expect(caps.supportsContinue).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Codex: --continue with no threads emits system_message
// ---------------------------------------------------------------------------

describe("Codex: --continue behavior", () => {
  it("listSessions falls back to disk when transport is not connected", async () => {
    const adapter = new CodexAdapter()
    const sessions = await adapter.listSessions()
    // When transport is not alive, Codex reads from ~/.codex/sessions/ on disk.
    // The result is an array (empty if no local sessions exist).
    expect(Array.isArray(sessions)).toBe(true)
    adapter.close()
  })
})

// ---------------------------------------------------------------------------
// ACP: --resume without loadSession
// ---------------------------------------------------------------------------

describe("ACP: --resume without loadSession capability", () => {
  it("capabilities reflect loadSession state accurately", () => {
    const adapter = new AcpAdapter({
      command: "echo",
      args: [],
      displayName: "Test Agent",
      presetName: "test",
    })

    // Before initialization: no capabilities
    expect(adapter.capabilities().supportsResume).toBe(false)
    expect(adapter.capabilities().supportsContinue).toBe(false)

    // After initialization with loadSession
    ;(adapter as any).agentCapabilities = { loadSession: true }
    expect(adapter.capabilities().supportsResume).toBe(true)
    expect(adapter.capabilities().supportsContinue).toBe(true)

    // After initialization without loadSession
    ;(adapter as any).agentCapabilities = {}
    expect(adapter.capabilities().supportsResume).toBe(false)
    expect(adapter.capabilities().supportsContinue).toBe(false)

    adapter.close()
  })

  it("listSessions returns empty when transport is not connected", async () => {
    const adapter = new AcpAdapter({
      command: "echo",
      args: [],
      displayName: "Test Agent",
      presetName: "test",
    })
    const sessions = await adapter.listSessions()
    expect(sessions).toEqual([])
    adapter.close()
  })
})
