import { describe, expect, it } from "bun:test"
import { GeminiAdapter } from "../../src/backends/gemini/adapter"

describe("GeminiAdapter", () => {
  describe("capabilities", () => {
    it("reports gemini capabilities", () => {
      const adapter = new GeminiAdapter()
      const caps = adapter.capabilities()

      expect(caps.name).toBe("gemini")
      expect(caps.supportsThinking).toBe(true)
      expect(caps.supportsToolApproval).toBe(false) // SDK handles tools internally
      expect(caps.supportsResume).toBe(true)
      expect(caps.supportsFork).toBe(false)
      expect(caps.supportsStreaming).toBe(true)
      expect(caps.supportsSubagents).toBe(false)
      expect(caps.supportedPermissionModes).toContain("default")
    })
  })

  describe("message queuing", () => {
    it("sendMessage queues messages without throwing", () => {
      const adapter = new GeminiAdapter()
      adapter.sendMessage({ text: "hello" })
      adapter.sendMessage({ text: "world" })
      adapter.close()
    })
  })

  describe("tool approval no-ops", () => {
    it("approveToolUse is a no-op", () => {
      const adapter = new GeminiAdapter()
      adapter.approveToolUse("nonexistent")
      adapter.close()
    })

    it("denyToolUse is a no-op", () => {
      const adapter = new GeminiAdapter()
      adapter.denyToolUse("nonexistent", "reason")
      adapter.close()
    })

    it("respondToElicitation is a no-op", () => {
      const adapter = new GeminiAdapter()
      adapter.respondToElicitation("nonexistent", { answer: "yes" })
      adapter.close()
    })

    it("cancelElicitation is a no-op", () => {
      const adapter = new GeminiAdapter()
      adapter.cancelElicitation("nonexistent")
      adapter.close()
    })
  })

  describe("interrupt", () => {
    it("interrupt without active session is safe", () => {
      const adapter = new GeminiAdapter()
      adapter.interrupt()
      adapter.close()
    })
  })

  describe("close", () => {
    it("close is idempotent", () => {
      const adapter = new GeminiAdapter()
      adapter.close()
      adapter.close()
      adapter.close()
    })
  })

  describe("setModel / setPermissionMode", () => {
    it("setModel does not throw", async () => {
      const adapter = new GeminiAdapter()
      await adapter.setModel("gemini-2.5-pro")
      adapter.close()
    })

    it("setPermissionMode does not throw", async () => {
      const adapter = new GeminiAdapter()
      await adapter.setPermissionMode("default")
      adapter.close()
    })
  })

  describe("availableModels", () => {
    it("returns known Gemini models", async () => {
      const adapter = new GeminiAdapter()
      const models = await adapter.availableModels()
      expect(models.length).toBeGreaterThan(0)
      expect(models[0]!.provider).toBe("google")
      adapter.close()
    })
  })

  describe("listSessions", () => {
    it("returns empty (not implemented)", async () => {
      const adapter = new GeminiAdapter()
      const sessions = await adapter.listSessions()
      expect(sessions).toEqual([])
      adapter.close()
    })
  })

  describe("forkSession", () => {
    it("throws (not supported)", async () => {
      const adapter = new GeminiAdapter()
      await expect(adapter.forkSession("some-id")).rejects.toThrow(
        "Fork not supported",
      )
      adapter.close()
    })
  })
})
