import { describe, expect, it } from "bun:test"
import {
  CodexAdapter,
  toCodexApprovalPolicy,
  toCodexSandboxPolicy,
} from "../../src/backends/codex/adapter"

describe("CodexAdapter", () => {
  describe("capabilities", () => {
    it("reports codex capabilities", () => {
      const adapter = new CodexAdapter()
      const caps = adapter.capabilities()

      expect(caps.name).toBe("codex")
      expect(caps.supportsThinking).toBe(true)
      expect(caps.supportsToolApproval).toBe(true)
      expect(caps.supportsResume).toBe(true)
      expect(caps.supportsFork).toBe(true)
      expect(caps.supportsStreaming).toBe(true)
      expect(caps.supportsSubagents).toBe(false)
      expect(caps.supportedPermissionModes).toContain("default")
      expect(caps.supportedPermissionModes).toContain("bypassPermissions")
    })
  })

  describe("permission mode mapping", () => {
    it("maps bypassPermissions to never approval + dangerFullAccess sandbox", () => {
      expect(toCodexApprovalPolicy("bypassPermissions")).toBe("never")
      expect(toCodexSandboxPolicy("bypassPermissions")).toEqual({
        type: "dangerFullAccess",
      })
    })

    it("maps default to on-request approval without sandbox override", () => {
      expect(toCodexApprovalPolicy("default")).toBe("on-request")
      expect(toCodexSandboxPolicy("default")).toBeUndefined()
    })
  })

  describe("message queuing", () => {
    it("sendMessage queues messages without throwing", () => {
      const adapter = new CodexAdapter()
      adapter.sendMessage({ text: "hello" })
      adapter.sendMessage({ text: "world" })
      adapter.close()
    })
  })

  describe("approval bridge", () => {
    it("approveToolUse on unknown id is a no-op", () => {
      const adapter = new CodexAdapter()
      adapter.approveToolUse("nonexistent")
      adapter.close()
    })

    it("denyToolUse on unknown id is a no-op", () => {
      const adapter = new CodexAdapter()
      adapter.denyToolUse("nonexistent", "reason")
      adapter.close()
    })

    it("respondToElicitation on unknown id is a no-op", () => {
      const adapter = new CodexAdapter()
      adapter.respondToElicitation("nonexistent", { answer: "yes" })
      adapter.close()
    })

    it("cancelElicitation on unknown id is a no-op", () => {
      const adapter = new CodexAdapter()
      adapter.cancelElicitation("nonexistent")
      adapter.close()
    })
  })

  describe("interrupt", () => {
    it("interrupt without active session is safe", () => {
      const adapter = new CodexAdapter()
      adapter.interrupt() // no transport, no thread — should not throw
      adapter.close()
    })
  })

  describe("close", () => {
    it("close is idempotent", () => {
      const adapter = new CodexAdapter()
      adapter.close()
      adapter.close()
      adapter.close()
    })
  })

  describe("setModel / setPermissionMode", () => {
    it("setModel does not throw", async () => {
      const adapter = new CodexAdapter()
      await adapter.setModel("o3")
      adapter.close()
    })

    it("setPermissionMode does not throw", async () => {
      const adapter = new CodexAdapter()
      await adapter.setPermissionMode("default")
      adapter.close()
    })
  })

  describe("availableModels", () => {
    it("returns known Codex models", async () => {
      const adapter = new CodexAdapter()
      const models = await adapter.availableModels()
      expect(models.length).toBeGreaterThan(0)
      expect(models[0]!.provider).toBe("openai")
      adapter.close()
    })
  })

  describe("listSessions", () => {
    it("falls back to disk when transport is not connected", async () => {
      const adapter = new CodexAdapter()
      const sessions = await adapter.listSessions()
      // When transport is not alive, Codex reads from ~/.codex/sessions/ on disk.
      // The result is an array (empty if no local sessions exist).
      expect(Array.isArray(sessions)).toBe(true)
      adapter.close()
    })
  })

  describe("forkSession", () => {
    it("throws when transport is not connected", async () => {
      const adapter = new CodexAdapter()
      await expect(adapter.forkSession("some-id")).rejects.toThrow(
        "Transport not connected",
      )
      adapter.close()
    })
  })
})
