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

    it("setPermissionMode throws (not supported by Gemini)", async () => {
      const adapter = new GeminiAdapter()
      await expect(adapter.setPermissionMode("default")).rejects.toThrow(
        "not supported",
      )
      adapter.close()
    })
  })

  describe("availableModels", () => {
    it("returns empty when no credentials are available", async () => {
      const saved = process.env["GEMINI_API_KEY"]
      const savedHome = process.env["HOME"]
      delete process.env["GEMINI_API_KEY"]
      // Point HOME to a temp dir with no .gemini/oauth_creds.json
      process.env["HOME"] = "/tmp/gemini-adapter-test-no-creds"
      try {
        const adapter = new GeminiAdapter()
        const models = await adapter.availableModels()
        expect(models).toEqual([])
        adapter.close()
      } finally {
        if (saved !== undefined) process.env["GEMINI_API_KEY"] = saved
        if (savedHome !== undefined) process.env["HOME"] = savedHome
      }
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
