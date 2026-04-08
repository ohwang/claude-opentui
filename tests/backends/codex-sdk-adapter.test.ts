import { describe, expect, it } from "bun:test"
import { CodexSdkAdapter } from "../../src/backends/codex-sdk/adapter"

describe("CodexSdkAdapter", () => {
  describe("capabilities", () => {
    it("reports codex-sdk capabilities", () => {
      const adapter = new CodexSdkAdapter()
      const caps = adapter.capabilities()

      expect(caps.name).toBe("codex-sdk")
      expect(caps.supportsThinking).toBe(true)
      expect(caps.supportsToolApproval).toBe(false) // SDK manages via policy
      expect(caps.supportsResume).toBe(true)
      expect(caps.supportsFork).toBe(false)
      expect(caps.supportsStreaming).toBe(true)
      expect(caps.supportsSubagents).toBe(false)
      expect(caps.supportedPermissionModes).toContain("default")
      expect(caps.supportedPermissionModes).toContain("bypassPermissions")
    })

    it("reports SDK version", () => {
      const adapter = new CodexSdkAdapter()
      const caps = adapter.capabilities()
      expect(caps.sdkVersion).toBeDefined()
      expect(caps.sdkVersion).not.toBe("")
    })
  })

  describe("message queuing", () => {
    it("sendMessage queues messages without throwing", () => {
      const adapter = new CodexSdkAdapter()
      adapter.sendMessage({ text: "hello" })
      adapter.sendMessage({ text: "world" })
      adapter.close()
    })
  })

  describe("tool approval no-ops", () => {
    it("approveToolUse is a no-op", () => {
      const adapter = new CodexSdkAdapter()
      adapter.approveToolUse("nonexistent")
      adapter.close()
    })

    it("denyToolUse is a no-op", () => {
      const adapter = new CodexSdkAdapter()
      adapter.denyToolUse("nonexistent", "reason")
      adapter.close()
    })

    it("respondToElicitation is a no-op", () => {
      const adapter = new CodexSdkAdapter()
      adapter.respondToElicitation("nonexistent", { answer: "yes" })
      adapter.close()
    })

    it("cancelElicitation is a no-op", () => {
      const adapter = new CodexSdkAdapter()
      adapter.cancelElicitation("nonexistent")
      adapter.close()
    })
  })

  describe("interrupt", () => {
    it("interrupt without active session is safe", () => {
      const adapter = new CodexSdkAdapter()
      adapter.interrupt()
      adapter.close()
    })
  })

  describe("close", () => {
    it("close is idempotent", () => {
      const adapter = new CodexSdkAdapter()
      adapter.close()
      adapter.close()
      adapter.close()
    })
  })

  describe("setModel / setPermissionMode", () => {
    it("setModel does not throw", async () => {
      const adapter = new CodexSdkAdapter()
      await adapter.setModel("o3")
      adapter.close()
    })

    it("setPermissionMode does not throw", async () => {
      const adapter = new CodexSdkAdapter()
      await adapter.setPermissionMode("default")
      adapter.close()
    })
  })

  describe("availableModels", () => {
    it("returns known Codex models", async () => {
      const adapter = new CodexSdkAdapter()
      const models = await adapter.availableModels()
      expect(models.length).toBeGreaterThan(0)
      expect(models[0]!.provider).toBe("openai")
      expect(models.map(m => m.id)).toContain("o3")
      adapter.close()
    })
  })

  describe("listSessions", () => {
    it("returns empty (not exposed by SDK)", async () => {
      const adapter = new CodexSdkAdapter()
      const sessions = await adapter.listSessions()
      expect(sessions).toEqual([])
      adapter.close()
    })
  })

  describe("forkSession", () => {
    it("throws (not supported)", async () => {
      const adapter = new CodexSdkAdapter()
      await expect(adapter.forkSession("some-id")).rejects.toThrow(
        "Fork not supported",
      )
      adapter.close()
    })
  })
})
