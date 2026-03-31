import { describe, expect, it, mock, beforeEach } from "bun:test"
import { ClaudeAdapter } from "../../src/backends/claude/adapter"

describe("ClaudeAdapter", () => {
  describe("capabilities", () => {
    it("reports Claude capabilities", () => {
      const adapter = new ClaudeAdapter()
      const caps = adapter.capabilities()

      expect(caps.name).toBe("claude")
      expect(caps.supportsThinking).toBe(true)
      expect(caps.supportsToolApproval).toBe(true)
      expect(caps.supportsResume).toBe(true)
      expect(caps.supportsFork).toBe(true)
      expect(caps.supportsStreaming).toBe(true)
      expect(caps.supportsSubagents).toBe(true)
      expect(caps.supportedPermissionModes).toContain("default")
      expect(caps.supportedPermissionModes).toContain("bypassPermissions")
    })
  })

  describe("message queuing", () => {
    it("sendMessage queues messages", () => {
      const adapter = new ClaudeAdapter()

      // Should not throw
      adapter.sendMessage({ text: "hello" })
      adapter.sendMessage({ text: "world" })

      adapter.close()
    })
  })

  describe("permission bridge", () => {
    it("approveToolUse resolves pending permission", () => {
      const adapter = new ClaudeAdapter()

      // Simulate a pending permission (internal state)
      // We can't directly test the canUseTool callback without the SDK
      // but we verify approve/deny don't throw on unknown IDs
      adapter.approveToolUse("nonexistent")
      adapter.denyToolUse("nonexistent", "reason")

      adapter.close()
    })

    it("respondToElicitation resolves pending elicitation", () => {
      const adapter = new ClaudeAdapter()

      adapter.respondToElicitation("nonexistent", { answer: "yes" })

      adapter.close()
    })
  })

  describe("interrupt", () => {
    it("interrupt without active query is safe", () => {
      const adapter = new ClaudeAdapter()

      // Should not throw
      adapter.interrupt()

      adapter.close()
    })
  })

  describe("close", () => {
    it("close is idempotent", () => {
      const adapter = new ClaudeAdapter()

      adapter.close()
      adapter.close() // Should not throw

      // sendMessage after close should be safe
      adapter.sendMessage({ text: "after close" })
    })

    it("close nulls eventChannel without crashing background loop", () => {
      const adapter = new ClaudeAdapter()

      // Simulate the state where eventChannel exists (as during iterateQuery)
      const { EventChannel } = require("../../src/utils/event-channel")
      ;(adapter as any).eventChannel = new EventChannel()

      // close() nulls eventChannel — the background sdkLoop must not crash
      adapter.close()
      expect((adapter as any).eventChannel).toBeNull()

      // Simulating what the background loop does after close:
      // this.eventChannel?.close() should be safe (not this.eventChannel!.close())
      const channel = (adapter as any).eventChannel
      expect(() => channel?.close()).not.toThrow()
    })
  })

  describe("SDKMessage mapping", () => {
    // These test the private mapSDKMessage method via its public effects.
    // We test the mapping logic directly since it's the adapter's core value.

    it("maps system init message correctly", () => {
      const adapter = new ClaudeAdapter()
      const events = (adapter as any).mapSDKMessage({
        type: "system",
        subtype: "init",
        tools: ["Read", "Write", "Bash"],
        model: "claude-sonnet-4-6",
        cwd: "/tmp",
        uuid: "test-uuid",
        session_id: "test-session",
      })

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe("session_init")
      expect(events[0].tools).toEqual([
        { name: "Read" },
        { name: "Write" },
        { name: "Bash" },
      ])
      expect(events[0].models).toEqual([
        { id: "claude-sonnet-4-6", name: "claude-sonnet-4-6", provider: "anthropic" },
      ])
    })

    it("maps result success to turn_complete", () => {
      const adapter = new ClaudeAdapter()
      const events = (adapter as any).mapSDKMessage({
        type: "result",
        subtype: "success",
        is_error: false,
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 10,
        },
        total_cost_usd: 0.005,
        uuid: "test",
        session_id: "test",
      })

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe("turn_complete")
      expect(events[0].usage.inputTokens).toBe(100)
      expect(events[0].usage.outputTokens).toBe(50)
      expect(events[0].usage.cacheReadTokens).toBe(10)
      expect(events[0].usage.totalCostUsd).toBe(0.005)
    })

    it("maps result error to error + turn_complete", () => {
      const adapter = new ClaudeAdapter()
      const events = (adapter as any).mapSDKMessage({
        type: "result",
        subtype: "error_max_turns",
        is_error: true,
        errors: ["Too many turns"],
        usage: { input_tokens: 200, output_tokens: 100 },
        total_cost_usd: 0.01,
        uuid: "test",
        session_id: "test",
      })

      expect(events).toHaveLength(2)
      expect(events[0].type).toBe("error")
      expect(events[0].code).toBe("error_max_turns")
      expect(events[1].type).toBe("turn_complete")
    })

    it("maps stream_event content_block_delta text_delta", () => {
      const adapter = new ClaudeAdapter()
      const events = (adapter as any).mapStreamEvent(
        {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Hello world" },
        },
        null,
      )

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({ type: "text_delta", text: "Hello world" })
    })

    it("maps stream_event content_block_delta thinking_delta", () => {
      const adapter = new ClaudeAdapter()
      const events = (adapter as any).mapStreamEvent(
        {
          type: "content_block_delta",
          delta: { type: "thinking_delta", thinking: "Let me think..." },
        },
        null,
      )

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
        type: "thinking_delta",
        text: "Let me think...",
      })
    })

    it("maps stream_event content_block_start tool_use", () => {
      const adapter = new ClaudeAdapter()
      const events = (adapter as any).mapStreamEvent(
        {
          type: "content_block_start",
          content_block: {
            type: "tool_use",
            id: "tool_123",
            name: "Read",
          },
        },
        null,
      )

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe("tool_use_start")
      expect(events[0].id).toBe("tool_123")
      expect(events[0].tool).toBe("Read")
    })

    it("maps stream_event message_start to turn_start", () => {
      const adapter = new ClaudeAdapter()
      const events = (adapter as any).mapStreamEvent(
        { type: "message_start" },
        null,
      )

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe("turn_start")
    })

    it("maps compacting status to compact event", () => {
      const adapter = new ClaudeAdapter()
      const events = (adapter as any).mapSDKMessage({
        type: "system",
        subtype: "status",
        status: "compacting",
        uuid: "test",
        session_id: "test",
      })

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe("compact")
    })

    it("maps rate_limit to recoverable error", () => {
      const adapter = new ClaudeAdapter()
      const events = (adapter as any).mapSDKMessage({
        type: "rate_limit",
        uuid: "test",
        session_id: "test",
      })

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe("error")
      expect(events[0].severity).toBe("recoverable")
    })

    it("maps unknown message type to backend_specific", () => {
      const adapter = new ClaudeAdapter()
      const events = (adapter as any).mapSDKMessage({
        type: "some_future_type",
        data: "test",
        uuid: "test",
        session_id: "test",
      })

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe("backend_specific")
      expect(events[0].backend).toBe("claude")
    })

    it("maps user tool_result with is_error to tool_use_end with error", () => {
      const adapter = new ClaudeAdapter()
      const events = (adapter as any).mapSDKMessage({
        type: "user",
        tool_use_result: true,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_err_1",
              is_error: true,
              content: "File not found: /nonexistent.txt",
            },
          ],
        },
      })

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe("tool_use_end")
      expect(events[0].id).toBe("tool_err_1")
      expect(events[0].error).toBe("File not found: /nonexistent.txt")
    })

    it("maps user tool_result with tool_use_id on msg directly", () => {
      const adapter = new ClaudeAdapter()
      const events = (adapter as any).mapSDKMessage({
        type: "user",
        tool_use_result: "some output",
        tool_use_id: "tool_fb_1",
        message: { role: "user", content: [] },
      })

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe("tool_use_end")
      expect(events[0].id).toBe("tool_fb_1")
      expect(events[0].output).toBe("some output")
    })

    it("maps user tool_result with object tool_use_result containing error", () => {
      const adapter = new ClaudeAdapter()
      const events = (adapter as any).mapSDKMessage({
        type: "user",
        tool_use_result: {
          tool_use_id: "tool_obj_1",
          is_error: true,
          error: "Permission denied",
          content: "Permission denied",
        },
        message: { role: "user", content: [] },
      })

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe("tool_use_end")
      expect(events[0].id).toBe("tool_obj_1")
      expect(events[0].error).toBe("Permission denied")
    })

    it("maps user tool_result with msg-level is_error flag", () => {
      const adapter = new ClaudeAdapter()
      const events = (adapter as any).mapSDKMessage({
        type: "user",
        tool_use_result: "Timeout exceeded",
        is_error: true,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_flag_1",
              content: "Timeout exceeded",
            },
          ],
        },
      })

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe("tool_use_end")
      expect(events[0].id).toBe("tool_flag_1")
      expect(events[0].error).toBe("Timeout exceeded")
    })

    it("emits tool_use_end with sentinel when tool_use_id cannot be determined", () => {
      const adapter = new ClaudeAdapter()
      const events = (adapter as any).mapSDKMessage({
        type: "user",
        tool_use_result: 42, // non-string, non-object
        message: { role: "user", content: [] },
      })

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe("tool_use_end")
      expect(events[0].id).toBe("__last_running__")
    })

    it("maps user tool_result with array content blocks containing text", () => {
      const adapter = new ClaudeAdapter()
      const events = (adapter as any).mapSDKMessage({
        type: "user",
        tool_use_result: true,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_arr_1",
              is_error: true,
              content: [
                { type: "text", text: "Error on line 1" },
                { type: "text", text: "Error on line 2" },
              ],
            },
          ],
        },
      })

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe("tool_use_end")
      expect(events[0].id).toBe("tool_arr_1")
      expect(events[0].error).toBe("Error on line 1\nError on line 2")
      expect(events[0].output).toBe("Error on line 1\nError on line 2")
    })
  })
})
