import { describe, expect, it } from "bun:test"
import { ClaudeV2Adapter } from "../../src/backends/claude/adapter-v2"
import { handlePermission, type PermissionBridgeState } from "../../src/backends/claude/permission-bridge"

describe("ClaudeV2Adapter", () => {
  describe("capabilities", () => {
    it("reports claude-v2 capabilities", () => {
      const adapter = new ClaudeV2Adapter()
      const caps = adapter.capabilities()

      expect(caps.name).toBe("claude-v2")
      expect(caps.supportsThinking).toBe(true)
      expect(caps.supportsToolApproval).toBe(true)
      expect(caps.supportsResume).toBe(true)
      expect(caps.supportsFork).toBe(false) // V2 doesn't expose fork
      expect(caps.supportsStreaming).toBe(true)
      expect(caps.supportsSubagents).toBe(true)
      expect(caps.supportedPermissionModes).toContain("default")
      expect(caps.supportedPermissionModes).toContain("bypassPermissions")
    })
  })

  describe("message queuing", () => {
    it("sendMessage queues messages without throwing", () => {
      const adapter = new ClaudeV2Adapter()
      adapter.sendMessage({ text: "hello" })
      adapter.sendMessage({ text: "world" })
      adapter.close()
    })
  })

  describe("permission bridge", () => {
    it("approveToolUse on unknown id is a no-op", () => {
      const adapter = new ClaudeV2Adapter()
      adapter.approveToolUse("nonexistent")
      adapter.close()
    })

    it("denyToolUse on unknown id is a no-op", () => {
      const adapter = new ClaudeV2Adapter()
      adapter.denyToolUse("nonexistent", "reason")
      adapter.close()
    })

    it("respondToElicitation on unknown id is a no-op", () => {
      const adapter = new ClaudeV2Adapter()
      adapter.respondToElicitation("nonexistent", { answer: "yes" })
      adapter.close()
    })

    it("cancelElicitation on unknown id is a no-op", () => {
      const adapter = new ClaudeV2Adapter()
      adapter.cancelElicitation("nonexistent")
      adapter.close()
    })
  })

  describe("interrupt", () => {
    it("interrupt without active session is safe", () => {
      const adapter = new ClaudeV2Adapter()
      adapter.interrupt()
      adapter.close()
    })

    it("interrupt pushes synthetic turn_complete when eventChannel exists", () => {
      const adapter = new ClaudeV2Adapter()
      const { EventChannel } = require("../../src/utils/event-channel")
      const channel = new EventChannel()
      ;(adapter as any).eventChannel = channel

      adapter.interrupt()

      // After interrupt, the channel should have a turn_complete queued.
      // Drain synchronously from the internal queue.
      const queue = (channel as any).queue as any[]
      expect(queue.some((e: any) => e.type === "turn_complete")).toBe(true)
    })
  })

  describe("close", () => {
    it("close is idempotent", () => {
      const adapter = new ClaudeV2Adapter()
      adapter.close()
      adapter.close()
    })

    it("sendMessage after close is safe", () => {
      const adapter = new ClaudeV2Adapter()
      adapter.close()
      adapter.sendMessage({ text: "after close" })
    })

    it("close rejects pending permissions", async () => {
      const adapter = new ClaudeV2Adapter()
      const { EventChannel } = require("../../src/utils/event-channel")
      ;(adapter as any).eventChannel = new EventChannel()

      const permPromise = handlePermission(
        "perm_1",
        "Bash",
        { command: "ls" },
        {},
        (adapter as any).bridgeState,
      )

      adapter.close()

      await expect(permPromise).rejects.toThrow("Adapter closed")
    })

    it("close rejects pending elicitations", async () => {
      const adapter = new ClaudeV2Adapter()
      const { EventChannel } = require("../../src/utils/event-channel")
      ;(adapter as any).eventChannel = new EventChannel()

      // Manually set up a pending elicitation
      const elicPromise = new Promise<any>((resolve, reject) => {
        ;(adapter as any).pendingElicitations.set("elic_1", { resolve, reject })
      })

      adapter.close()

      await expect(elicPromise).rejects.toThrow("Adapter closed")
    })
  })

  describe("setModel / setPermissionMode", () => {
    it("setModel does not throw (logs warning)", async () => {
      const adapter = new ClaudeV2Adapter()
      await adapter.setModel("claude-opus-4-6")
      adapter.close()
    })

    it("setPermissionMode does not throw (logs warning)", async () => {
      const adapter = new ClaudeV2Adapter()
      await adapter.setPermissionMode("bypassPermissions")
      adapter.close()
    })
  })

  describe("availableModels", () => {
    it("returns empty array (V2 does not expose model list)", async () => {
      const adapter = new ClaudeV2Adapter()
      const models = await adapter.availableModels()
      expect(models).toEqual([])
      adapter.close()
    })
  })

  describe("forkSession", () => {
    it("throws not supported error", async () => {
      const adapter = new ClaudeV2Adapter()
      await expect(adapter.forkSession("some-id")).rejects.toThrow(
        "Fork not supported on V2 adapter",
      )
      adapter.close()
    })
  })

  describe("session denied tools", () => {
    it("denyToolUse with denyForSession tracks the tool for auto-deny", async () => {
      const adapter = new ClaudeV2Adapter()
      const { EventChannel } = require("../../src/utils/event-channel")
      ;(adapter as any).eventChannel = new EventChannel()

      // Create a pending permission for "Bash"
      const firstPerm = handlePermission(
        "perm_1",
        "Bash",
        { command: "rm -rf /" },
        {},
        (adapter as any).bridgeState,
      )

      // Deny with session flag
      adapter.denyToolUse("perm_1", "Dangerous", { denyForSession: true })
      const result1 = await firstPerm
      expect(result1.behavior).toBe("deny")

      // Next Bash permission should be auto-denied
      const result2 = await handlePermission(
        "perm_2",
        "Bash",
        { command: "ls" },
        {},
        (adapter as any).bridgeState,
      )
      expect(result2.behavior).toBe("deny")
      expect(result2.behavior === "deny" && result2.message).toBe("Denied for session")

      adapter.close()
    })
  })
})
