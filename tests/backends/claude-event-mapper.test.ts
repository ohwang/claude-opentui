import { describe, expect, it } from "bun:test"
import {
  mapSDKMessage,
  mapAssistantMessage,
  mapStreamEvent,
  ToolStreamState,
} from "../../src/backends/claude/event-mapper"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshState(): ToolStreamState {
  return new ToolStreamState()
}

// ---------------------------------------------------------------------------
// mapSDKMessage — system messages
// ---------------------------------------------------------------------------

describe("Claude Event Mapper — mapSDKMessage", () => {
  describe("system init", () => {
    it("maps system init to session_init with tools and model", () => {
      const events = mapSDKMessage(
        {
          type: "system",
          subtype: "init",
          model: "claude-opus-4-6",
          tools: ["Read", "Edit", "Bash"],
        },
        freshState(),
      )

      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe("session_init")
      const init = events[0] as any
      expect(init.tools).toEqual([
        { name: "Read" },
        { name: "Edit" },
        { name: "Bash" },
      ])
      expect(init.models).toHaveLength(1)
      expect(init.models[0].id).toBe("claude-opus-4-6")
      expect(init.models[0].provider).toBe("anthropic")
    })

    it("extracts context window from [1M context] suffix", () => {
      const events = mapSDKMessage(
        {
          type: "system",
          subtype: "init",
          model: "claude-opus-4-6 [1M context]",
          tools: [],
        },
        freshState(),
      )

      const init = events[0] as any
      expect(init.models[0].id).toBe("claude-opus-4-6")
      expect(init.models[0].contextWindow).toBe(1_000_000)
    })

    it("extracts context window from [200K context] suffix", () => {
      const events = mapSDKMessage(
        {
          type: "system",
          subtype: "init",
          model: "claude-sonnet-4 [200K context]",
          tools: [],
        },
        freshState(),
      )

      const init = events[0] as any
      expect(init.models[0].id).toBe("claude-sonnet-4")
      expect(init.models[0].contextWindow).toBe(200_000)
    })

    it("extracts context window from compact [1m] format", () => {
      const events = mapSDKMessage(
        {
          type: "system",
          subtype: "init",
          model: "claude-opus-4-6[1m]",
          tools: [],
        },
        freshState(),
      )

      const init = events[0] as any
      expect(init.models[0].id).toBe("claude-opus-4-6")
      expect(init.models[0].contextWindow).toBe(1_000_000)
    })

    it("extracts context window from (1M context) parenthetical", () => {
      const events = mapSDKMessage(
        {
          type: "system",
          subtype: "init",
          model: "opus (1M context)",
          tools: [],
        },
        freshState(),
      )

      const init = events[0] as any
      expect(init.models[0].id).toBe("opus")
      expect(init.models[0].contextWindow).toBe(1_000_000)
    })

    it("handles missing model gracefully", () => {
      const events = mapSDKMessage(
        {
          type: "system",
          subtype: "init",
          tools: ["Bash"],
        },
        freshState(),
      )

      const init = events[0] as any
      expect(init.models).toEqual([])
      expect(init.tools).toHaveLength(1)
    })

    it("handles missing tools gracefully", () => {
      const events = mapSDKMessage(
        {
          type: "system",
          subtype: "init",
          model: "claude-sonnet-4",
        },
        freshState(),
      )

      const init = events[0] as any
      expect(init.tools).toEqual([])
    })

    it("includes session_id when present", () => {
      const events = mapSDKMessage(
        {
          type: "system",
          subtype: "init",
          model: "claude-sonnet-4",
          tools: [],
          session_id: "sess-123",
        },
        freshState(),
      )

      const init = events[0] as any
      expect(init.sessionId).toBe("sess-123")
    })

    it("includes account when present", () => {
      const events = mapSDKMessage(
        {
          type: "system",
          subtype: "init",
          model: "claude-sonnet-4",
          tools: [],
          account: { plan: "pro" },
        },
        freshState(),
      )

      const init = events[0] as any
      expect(init.account).toEqual({ plan: "pro" })
    })
  })

  describe("system status", () => {
    it("emits in-progress compact event on compacting status", () => {
      const events = mapSDKMessage(
        { type: "system", subtype: "status", status: "compacting" },
        freshState(),
      )
      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe("compact")
      expect((events[0] as any).inProgress).toBe(true)
      expect((events[0] as any).trigger).toBe("user")
    })

    it("ignores other status events", () => {
      const events = mapSDKMessage(
        { type: "system", subtype: "status", status: "thinking" },
        freshState(),
      )
      expect(events).toHaveLength(0)
    })
  })

  describe("compact boundary", () => {
    it("maps compact_boundary to compact event", () => {
      const events = mapSDKMessage(
        {
          type: "system",
          subtype: "compact_boundary",
          compact_metadata: { trigger: "auto", pre_tokens: 50000 },
        },
        freshState(),
      )

      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe("compact")
      expect((events[0] as any).trigger).toBe("auto")
      expect((events[0] as any).preTokens).toBe(50000)
    })

    it("handles missing compact_metadata gracefully", () => {
      const events = mapSDKMessage(
        { type: "system", subtype: "compact_boundary" },
        freshState(),
      )

      expect(events).toHaveLength(1)
      const compact = events[0] as any
      expect(compact.type).toBe("compact")
      expect(compact.summary).toBe("Conversation compacted.")
      expect(compact.trigger).toBe("user")
    })
  })

  describe("local_command_output", () => {
    it("maps to system_message", () => {
      const events = mapSDKMessage(
        {
          type: "system",
          subtype: "local_command_output",
          content: "Command output here",
        },
        freshState(),
      )

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
        type: "system_message",
        text: "Command output here",
      })
    })

    it("suppresses empty/missing content", () => {
      const events = mapSDKMessage(
        { type: "system", subtype: "local_command_output" },
        freshState(),
      )

      expect(events).toHaveLength(0)
    })

    it("suppresses trivial compact output with XML tags", () => {
      const events = mapSDKMessage(
        {
          type: "system",
          subtype: "local_command_output",
          content: "<local-command-stdout>Compacted </local-command-stdout>",
        },
        freshState(),
      )

      expect(events).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // stream_event passthrough
  // ---------------------------------------------------------------------------

  describe("stream_event", () => {
    it("delegates to mapStreamEvent and sets hasReceivedStreamEvent", () => {
      const state = freshState()
      expect(state.hasReceivedStreamEvent).toBe(false)

      const events = mapSDKMessage(
        {
          type: "stream_event",
          event: { type: "message_start", message: {} },
          parent_tool_use_id: null,
        },
        state,
      )

      expect(state.hasReceivedStreamEvent).toBe(true)
      expect(events.some((e) => e.type === "turn_start")).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // assistant messages
  // ---------------------------------------------------------------------------

  describe("assistant messages", () => {
    it("skips assistant messages in V1 live mode (hasReceivedStreamEvent=true, !mapAssistant)", () => {
      const state = freshState()
      state.hasReceivedStreamEvent = true

      const events = mapSDKMessage(
        {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Hello!" }],
          },
        },
        state,
      )

      expect(events).toHaveLength(0)
    })

    it("maps assistant messages in V2 mode (mapAssistant: true)", () => {
      const state = freshState()

      const events = mapSDKMessage(
        {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Hello!" }],
          },
        },
        state,
        { mapAssistant: true },
      )

      expect(events.length).toBeGreaterThan(0)
      expect(events.some((e) => e.type === "turn_start")).toBe(true)
      expect(events.some((e) => e.type === "text_delta")).toBe(true)
    })

    it("maps assistant messages in replay mode with synthetic turn_complete", () => {
      const state = freshState()
      // hasReceivedStreamEvent = false (default) + !mapAssistant = replay mode

      const events = mapSDKMessage(
        {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Replayed answer" }],
          },
        },
        state,
      )

      expect(events.some((e) => e.type === "turn_start")).toBe(true)
      expect(events.some((e) => e.type === "text_delta")).toBe(true)
      // Replay mode adds synthetic turn_complete
      const lastEvent = events[events.length - 1]!
      expect(lastEvent.type).toBe("turn_complete")
      expect((lastEvent as any).usage).toEqual({
        inputTokens: 0,
        outputTokens: 0,
      })
    })
  })

  // ---------------------------------------------------------------------------
  // result messages
  // ---------------------------------------------------------------------------

  describe("result messages", () => {
    it("maps success result to turn_complete with usage", () => {
      const events = mapSDKMessage(
        {
          type: "result",
          subtype: "success",
          session_id: "sess-abc",
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 20,
            cache_creation_input_tokens: 5,
          },
          total_cost_usd: 0.015,
        },
        freshState(),
      )

      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe("turn_complete")
      const tc = events[0] as any
      expect(tc.sessionId).toBe("sess-abc")
      expect(tc.usage.inputTokens).toBe(100)
      expect(tc.usage.outputTokens).toBe(50)
      expect(tc.usage.cacheReadTokens).toBe(20)
      expect(tc.usage.cacheWriteTokens).toBe(5)
      expect(tc.usage.totalCostUsd).toBe(0.015)
    })

    it("maps non-error result without subtype to turn_complete", () => {
      const events = mapSDKMessage(
        {
          type: "result",
          is_error: false,
          usage: { input_tokens: 10, output_tokens: 5 },
        },
        freshState(),
      )

      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe("turn_complete")
    })

    it("maps error result to error + turn_complete", () => {
      const events = mapSDKMessage(
        {
          type: "result",
          subtype: "error_during_execution",
          is_error: true,
          errors: ["Something went wrong"],
          usage: { input_tokens: 100, output_tokens: 0 },
          total_cost_usd: 0.001,
        },
        freshState(),
      )

      expect(events).toHaveLength(2)
      expect(events[0]!.type).toBe("error")
      const err = events[0] as any
      expect(err.code).toBe("error_during_execution")
      expect(err.message).toBe("Something went wrong")
      expect(err.severity).toBe("fatal")

      expect(events[1]!.type).toBe("turn_complete")
    })

    it("cleans error messages — strips stack traces and deduplicates", () => {
      const events = mapSDKMessage(
        {
          type: "result",
          is_error: true,
          errors: [
            "Error: connection failed\n    at Socket.connect (net.js:100)\n    at Object.<anonymous> (app.js:5)",
            "Error: connection failed\n    at Socket.connect (net.js:100)",
          ],
          usage: {},
        },
        freshState(),
      )

      const err = events[0] as any
      // Both errors should be deduped to one "Error: connection failed"
      expect(err.message).toBe("Error: connection failed")
    })

    it("caps error message at 200 characters", () => {
      const longError = "A".repeat(300)
      const events = mapSDKMessage(
        {
          type: "result",
          is_error: true,
          errors: [longError],
          usage: {},
        },
        freshState(),
      )

      const err = events[0] as any
      expect(err.message.length).toBeLessThanOrEqual(200)
      expect(err.message).toEndWith("...")
    })

    it("handles missing usage gracefully", () => {
      const events = mapSDKMessage(
        {
          type: "result",
          subtype: "success",
        },
        freshState(),
      )

      expect(events).toHaveLength(1)
      const tc = events[0] as any
      expect(tc.usage.inputTokens).toBe(0)
      expect(tc.usage.outputTokens).toBe(0)
    })

    it("handles missing errors array on error result", () => {
      const events = mapSDKMessage(
        {
          type: "result",
          is_error: true,
          usage: {},
        },
        freshState(),
      )

      const err = events[0] as any
      expect(err.message).toBe("Unknown error")
    })
  })

  // ---------------------------------------------------------------------------
  // tool_progress
  // ---------------------------------------------------------------------------

  describe("tool_progress", () => {
    it("maps to tool_use_progress", () => {
      const events = mapSDKMessage(
        {
          type: "tool_progress",
          tool_use_id: "tool-1",
          content: "Executing...",
          tool_name: "Bash",
          elapsed_time_seconds: 5,
        },
        freshState(),
      )

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
        type: "tool_use_progress",
        id: "tool-1",
        output: "Executing...",
      })
    })

    it("generates fallback output from tool_name and elapsed time", () => {
      const events = mapSDKMessage(
        {
          type: "tool_progress",
          tool_use_id: "tool-2",
          tool_name: "Read",
          elapsed_time_seconds: 10,
        },
        freshState(),
      )

      expect(events).toHaveLength(1)
      expect((events[0] as any).output).toBe("[Read] 10s elapsed")
    })
  })

  // ---------------------------------------------------------------------------
  // task events
  // ---------------------------------------------------------------------------

  describe("task lifecycle", () => {
    it("maps task_started to task_start", () => {
      const events = mapSDKMessage(
        {
          type: "task_started",
          task_id: "task-1",
          description: "Running tests",
          tool_use_id: "tool-1",
          task_type: "background",
        },
        freshState(),
      )

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
        type: "task_start",
        taskId: "task-1",
        description: "Running tests",
        toolUseId: "tool-1",
        taskType: "background",
      })
    })

    it("maps task_started with uuid fallback", () => {
      const events = mapSDKMessage(
        {
          type: "task_started",
          uuid: "uuid-1",
          description: "Compiling",
        },
        freshState(),
      )

      expect((events[0] as any).taskId).toBe("uuid-1")
    })

    it("maps task_progress", () => {
      const events = mapSDKMessage(
        {
          type: "task_progress",
          task_id: "task-1",
          content: "50% complete",
          last_tool_name: "Bash",
          summary: "Halfway done",
        },
        freshState(),
      )

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
        type: "task_progress",
        taskId: "task-1",
        output: "50% complete",
        lastToolName: "Bash",
        summary: "Halfway done",
      })
    })

    it("maps task_notification to task_complete", () => {
      const events = mapSDKMessage(
        {
          type: "task_notification",
          task_id: "task-1",
          content: "All tests passed",
          tool_use_id: "tool-1",
        },
        freshState(),
      )

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
        type: "task_complete",
        taskId: "task-1",
        output: "All tests passed",
        toolUseId: "tool-1",
      })
    })
  })

  // ---------------------------------------------------------------------------
  // rate_limit
  // ---------------------------------------------------------------------------

  describe("rate_limit", () => {
    it("maps to recoverable error", () => {
      const events = mapSDKMessage(
        { type: "rate_limit" },
        freshState(),
      )

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
        type: "error",
        code: "rate_limit",
        message: "Rate limited by API",
        severity: "recoverable",
      })
    })
  })

  // ---------------------------------------------------------------------------
  // user messages (tool results)
  // ---------------------------------------------------------------------------

  describe("user messages — tool results", () => {
    it("extracts tool_use_end from tool_result content block", () => {
      const events = mapSDKMessage(
        {
          type: "user",
          tool_use_result: true,
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-1",
                content: "file contents here",
                is_error: false,
              },
            ],
          },
        },
        freshState(),
      )

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
        type: "tool_use_end",
        id: "tool-1",
        output: "file contents here",
        error: undefined,
      })
    })

    it("marks tool error when is_error is true", () => {
      const events = mapSDKMessage(
        {
          type: "user",
          tool_use_result: true,
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-1",
                content: "Permission denied",
                is_error: true,
              },
            ],
          },
        },
        freshState(),
      )

      expect(events).toHaveLength(1)
      const end = events[0] as any
      expect(end.error).toBe("Permission denied")
    })

    it("extracts text from array content blocks", () => {
      const events = mapSDKMessage(
        {
          type: "user",
          tool_use_result: true,
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-1",
                content: [
                  { type: "text", text: "line 1" },
                  { type: "image", data: "..." },
                  { type: "text", text: "line 2" },
                ],
              },
            ],
          },
        },
        freshState(),
      )

      expect(events).toHaveLength(1)
      expect((events[0] as any).output).toBe("line 1\nline 2")
    })

    it("falls back to msg.tool_use_id when missing from content", () => {
      const events = mapSDKMessage(
        {
          type: "user",
          tool_use_result: "result text",
          tool_use_id: "tool-fallback",
          message: { content: [] },
        },
        freshState(),
      )

      expect(events).toHaveLength(1)
      expect((events[0] as any).id).toBe("tool-fallback")
      expect((events[0] as any).output).toBe("result text")
    })

    it("falls back to tool_use_result object with tool_use_id", () => {
      const events = mapSDKMessage(
        {
          type: "user",
          tool_use_result: {
            tool_use_id: "tool-obj",
            content: "object content",
          },
          message: { content: [] },
        },
        freshState(),
      )

      expect(events).toHaveLength(1)
      expect((events[0] as any).id).toBe("tool-obj")
      expect((events[0] as any).output).toBe("object content")
    })

    it("falls back to __last_running__ when no tool_use_id anywhere", () => {
      const events = mapSDKMessage(
        {
          type: "user",
          tool_use_result: "some output",
          message: { content: [] },
        },
        freshState(),
      )

      expect(events).toHaveLength(1)
      expect((events[0] as any).id).toBe("__last_running__")
    })

    it("detects error from msg-level is_error flag", () => {
      const events = mapSDKMessage(
        {
          type: "user",
          tool_use_result: "bad result",
          tool_use_id: "tool-1",
          is_error: true,
          message: { content: [] },
        },
        freshState(),
      )

      expect(events).toHaveLength(1)
      const end = events[0] as any
      expect(end.error).toBe("bad result")
    })

    it("detects error from tool_use_result.error field", () => {
      const events = mapSDKMessage(
        {
          type: "user",
          tool_use_result: {
            tool_use_id: "tool-1",
            error: "Something broke",
          },
          message: { content: [] },
        },
        freshState(),
      )

      expect(events).toHaveLength(1)
      const end = events[0] as any
      expect(end.error).toBe("Something broke")
    })
  })

  describe("user messages — replay", () => {
    it("extracts text content from replayed user message", () => {
      const events = mapSDKMessage(
        {
          type: "user",
          message: {
            content: [
              { type: "text", text: "What is 2+2?" },
            ],
          },
        },
        freshState(),
      )

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
        type: "user_message",
        text: "What is 2+2?",
      })
    })

    it("handles string content", () => {
      const events = mapSDKMessage(
        {
          type: "user",
          message: {
            content: "Plain string content",
          },
        },
        freshState(),
      )

      expect(events).toHaveLength(1)
      expect((events[0] as any).text).toBe("Plain string content")
    })

    it("skips subagent prompts (parent_tool_use_id present)", () => {
      const events = mapSDKMessage(
        {
          type: "user",
          parent_tool_use_id: "parent-tool-1",
          message: {
            content: [{ type: "text", text: "Subagent instruction" }],
          },
        },
        freshState(),
      )

      expect(events).toHaveLength(0)
    })

    it("skips empty text content", () => {
      const events = mapSDKMessage(
        {
          type: "user",
          message: {
            content: [{ type: "image", data: "..." }],
          },
        },
        freshState(),
      )

      expect(events).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // rate_limit_event (informational)
  // ---------------------------------------------------------------------------

  describe("rate_limit_event", () => {
    it("maps to backend_specific event", () => {
      const msg = {
        type: "rate_limit_event",
        rate_limit_info: { remaining: 100 },
      }
      const events = mapSDKMessage(msg, freshState())

      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe("backend_specific")
      expect((events[0] as any).backend).toBe("claude")
      expect((events[0] as any).data).toBe(msg)
    })
  })

  // ---------------------------------------------------------------------------
  // unknown message types
  // ---------------------------------------------------------------------------

  describe("unknown message types", () => {
    it("maps to backend_specific event", () => {
      const msg = { type: "future_event", data: "hello" }
      const events = mapSDKMessage(msg, freshState())

      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe("backend_specific")
      expect((events[0] as any).backend).toBe("claude")
    })
  })
})

// ---------------------------------------------------------------------------
// mapAssistantMessage
// ---------------------------------------------------------------------------

describe("Claude Event Mapper — mapAssistantMessage", () => {
  it("returns empty for non-array content", () => {
    expect(mapAssistantMessage({ message: {} })).toEqual([])
    expect(mapAssistantMessage({ message: { content: "string" } })).toEqual([])
    expect(mapAssistantMessage({})).toEqual([])
  })

  it("emits turn_start + text_delta for text block", () => {
    const events = mapAssistantMessage({
      message: {
        content: [{ type: "text", text: "Hello world" }],
      },
    })

    expect(events).toHaveLength(2)
    expect(events[0]).toEqual({ type: "turn_start" })
    expect(events[1]).toEqual({ type: "text_delta", text: "Hello world" })
  })

  it("skips empty text blocks", () => {
    const events = mapAssistantMessage({
      message: {
        content: [{ type: "text", text: "" }],
      },
    })

    // Only turn_start, no text_delta
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe("turn_start")
  })

  it("maps thinking blocks to thinking_delta", () => {
    const events = mapAssistantMessage({
      message: {
        content: [{ type: "thinking", thinking: "Let me think..." }],
      },
    })

    expect(events).toHaveLength(2)
    expect(events[1]).toEqual({
      type: "thinking_delta",
      text: "Let me think...",
    })
  })

  it("maps tool_use blocks to tool_use_start + tool_use_progress", () => {
    const events = mapAssistantMessage({
      message: {
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Read",
            input: { file_path: "/tmp/test.txt" },
          },
        ],
      },
    })

    expect(events).toHaveLength(3) // turn_start + tool_use_start + tool_use_progress
    expect(events[1]).toEqual({
      type: "tool_use_start",
      id: "tool-1",
      tool: "Read",
      input: { file_path: "/tmp/test.txt" },
    })
    expect(events[2]).toEqual({
      type: "tool_use_progress",
      id: "tool-1",
      output: "",
      input: { file_path: "/tmp/test.txt" },
    })
  })

  it("handles tool_use with no input", () => {
    const events = mapAssistantMessage({
      message: {
        content: [
          { type: "tool_use", id: "tool-1", name: "Bash" },
        ],
      },
    })

    // turn_start + tool_use_start (no progress since input is falsy)
    expect(events).toHaveLength(2)
    expect((events[1] as any).input).toEqual({})
  })

  it("maps mixed content blocks in order", () => {
    const events = mapAssistantMessage({
      message: {
        content: [
          { type: "thinking", thinking: "Planning..." },
          { type: "text", text: "I'll read the file." },
          {
            type: "tool_use",
            id: "tool-1",
            name: "Read",
            input: { path: "test.ts" },
          },
        ],
      },
    })

    const types = events.map((e) => e.type)
    expect(types).toEqual([
      "turn_start",
      "thinking_delta",
      "text_delta",
      "tool_use_start",
      "tool_use_progress",
    ])
  })

  it("handles unknown content block types gracefully", () => {
    const events = mapAssistantMessage({
      message: {
        content: [
          { type: "text", text: "Hello" },
          { type: "future_block_type", data: "unknown" },
        ],
      },
    })

    // Should have turn_start + text_delta (unknown block silently skipped with log.warn)
    expect(events).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// mapStreamEvent
// ---------------------------------------------------------------------------

describe("Claude Event Mapper — mapStreamEvent", () => {
  describe("message_start", () => {
    it("emits turn_start", () => {
      const events = mapStreamEvent(
        { type: "message_start", message: {} },
        null,
        freshState(),
      )

      expect(events.some((e) => e.type === "turn_start")).toBe(true)
    })

    it("emits cost_update from message usage", () => {
      const events = mapStreamEvent(
        {
          type: "message_start",
          message: {
            usage: {
              input_tokens: 1000,
              cache_read_input_tokens: 500,
              cache_creation_input_tokens: 200,
            },
          },
        },
        null,
        freshState(),
      )

      expect(events).toHaveLength(2) // turn_start + cost_update
      const cost = events.find((e) => e.type === "cost_update") as any
      expect(cost).toBeTruthy()
      expect(cost.contextTokens).toBe(1700) // 1000 + 500 + 200
      expect(cost.inputTokens).toBe(0)
      expect(cost.outputTokens).toBe(0)
    })

    it("skips cost_update when usage totals to zero", () => {
      const events = mapStreamEvent(
        {
          type: "message_start",
          message: {
            usage: { input_tokens: 0 },
          },
        },
        null,
        freshState(),
      )

      expect(events).toHaveLength(1) // just turn_start
    })
  })

  describe("content_block_start", () => {
    it("emits tool_use_start for tool_use blocks", () => {
      const state = freshState()
      const events = mapStreamEvent(
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "tool-1", name: "Bash" },
        },
        null,
        state,
      )

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
        type: "tool_use_start",
        id: "tool-1",
        tool: "Bash",
        input: {},
      })

      // Verify stream state was updated
      expect(state.currentToolIds.get(0)).toBe("tool-1")
      expect(state.toolInputJsons.get("tool-1")).toBe("")
    })

    it("ignores text and thinking block starts", () => {
      const events = mapStreamEvent(
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text" },
        },
        null,
        freshState(),
      )

      expect(events).toHaveLength(0)
    })
  })

  describe("content_block_delta", () => {
    it("maps text_delta", () => {
      const events = mapStreamEvent(
        {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Hello" },
        },
        null,
        freshState(),
      )

      expect(events).toEqual([{ type: "text_delta", text: "Hello" }])
    })

    it("maps thinking_delta", () => {
      const events = mapStreamEvent(
        {
          type: "content_block_delta",
          delta: { type: "thinking_delta", thinking: "Analyzing..." },
        },
        null,
        freshState(),
      )

      expect(events).toEqual([
        { type: "thinking_delta", text: "Analyzing..." },
      ])
    })

    it("accumulates input_json_delta fragments", () => {
      const state = freshState()
      state.currentToolIds.set(0, "tool-1")
      state.toolInputJsons.set("tool-1", "")

      // First fragment
      mapStreamEvent(
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"com' },
        },
        null,
        state,
      )

      expect(state.toolInputJsons.get("tool-1")).toBe('{"com')

      // Second fragment
      mapStreamEvent(
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: 'mand":"ls"}' },
        },
        null,
        state,
      )

      expect(state.toolInputJsons.get("tool-1")).toBe('{"command":"ls"}')
    })
  })

  describe("content_block_stop", () => {
    it("emits tool_use_progress with parsed JSON on tool block stop", () => {
      const state = freshState()
      state.currentToolIds.set(0, "tool-1")
      state.toolInputJsons.set("tool-1", '{"command":"ls -la"}')

      const events = mapStreamEvent(
        { type: "content_block_stop", index: 0 },
        null,
        state,
      )

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
        type: "tool_use_progress",
        id: "tool-1",
        output: "",
        input: { command: "ls -la" },
      })

      // Stream state cleaned up
      expect(state.currentToolIds.has(0)).toBe(false)
      expect(state.toolInputJsons.has("tool-1")).toBe(false)
    })

    it("emits raw JSON string on parse failure", () => {
      const state = freshState()
      state.currentToolIds.set(0, "tool-1")
      state.toolInputJsons.set("tool-1", "{invalid json")

      const events = mapStreamEvent(
        { type: "content_block_stop", index: 0 },
        null,
        state,
      )

      expect(events).toHaveLength(1)
      expect((events[0] as any).input).toBe("{invalid json")
    })

    it("is a no-op for non-tool blocks", () => {
      const state = freshState()
      // index 0 not in currentToolIds

      const events = mapStreamEvent(
        { type: "content_block_stop", index: 0 },
        null,
        state,
      )

      expect(events).toHaveLength(0)
    })
  })

  describe("message_delta", () => {
    it("emits cost_update with output tokens", () => {
      const events = mapStreamEvent(
        {
          type: "message_delta",
          usage: { output_tokens: 150 },
        },
        null,
        freshState(),
      )

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
        type: "cost_update",
        inputTokens: 0,
        outputTokens: 150,
      })
    })

    it("skips cost_update when no usage", () => {
      const events = mapStreamEvent(
        { type: "message_delta" },
        null,
        freshState(),
      )

      expect(events).toHaveLength(0)
    })
  })

  describe("message_stop", () => {
    it("produces no events", () => {
      const events = mapStreamEvent(
        { type: "message_stop" },
        null,
        freshState(),
      )

      expect(events).toHaveLength(0)
    })
  })

  describe("unknown stream events", () => {
    it("produces no events (logs warning)", () => {
      const events = mapStreamEvent(
        { type: "future_stream_event" },
        null,
        freshState(),
      )

      expect(events).toHaveLength(0)
    })
  })
})

// ---------------------------------------------------------------------------
// ToolStreamState
// ---------------------------------------------------------------------------

describe("ToolStreamState", () => {
  it("initializes with empty maps and false flag", () => {
    const state = new ToolStreamState()
    expect(state.toolInputJsons.size).toBe(0)
    expect(state.currentToolIds.size).toBe(0)
    expect(state.hasReceivedStreamEvent).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Full stream simulation
// ---------------------------------------------------------------------------

describe("Claude Event Mapper — full stream simulation", () => {
  it("simulates a complete text response turn", () => {
    const state = freshState()
    const allEvents: any[] = []

    // message_start
    allEvents.push(
      ...mapStreamEvent(
        {
          type: "message_start",
          message: { usage: { input_tokens: 500 } },
        },
        null,
        state,
      ),
    )

    // text deltas
    allEvents.push(
      ...mapStreamEvent(
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text" },
        },
        null,
        state,
      ),
    )
    allEvents.push(
      ...mapStreamEvent(
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hello " },
        },
        null,
        state,
      ),
    )
    allEvents.push(
      ...mapStreamEvent(
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "world!" },
        },
        null,
        state,
      ),
    )
    allEvents.push(
      ...mapStreamEvent(
        { type: "content_block_stop", index: 0 },
        null,
        state,
      ),
    )

    // message_delta with output usage
    allEvents.push(
      ...mapStreamEvent(
        {
          type: "message_delta",
          usage: { output_tokens: 10 },
        },
        null,
        state,
      ),
    )

    // message_stop
    allEvents.push(
      ...mapStreamEvent({ type: "message_stop" }, null, state),
    )

    // Then result comes as SDK message
    allEvents.push(
      ...mapSDKMessage(
        {
          type: "result",
          subtype: "success",
          usage: { input_tokens: 500, output_tokens: 10 },
          total_cost_usd: 0.01,
        },
        state,
      ),
    )

    const types = allEvents.map((e) => e.type)
    expect(types).toEqual([
      "turn_start",
      "cost_update",     // input context fill
      "text_delta",      // "Hello "
      "text_delta",      // "world!"
      "cost_update",     // output tokens
      "turn_complete",   // from result
    ])
  })

  it("simulates a tool-use turn with input JSON streaming", () => {
    const state = freshState()
    const allEvents: any[] = []

    // message_start
    allEvents.push(
      ...mapStreamEvent(
        { type: "message_start", message: {} },
        null,
        state,
      ),
    )

    // tool_use block start
    allEvents.push(
      ...mapStreamEvent(
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "tool-1", name: "Bash" },
        },
        null,
        state,
      ),
    )

    // Stream the tool input JSON
    allEvents.push(
      ...mapStreamEvent(
        {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: '{"command":',
          },
        },
        null,
        state,
      ),
    )
    allEvents.push(
      ...mapStreamEvent(
        {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: '"ls -la"}',
          },
        },
        null,
        state,
      ),
    )

    // content_block_stop — parses accumulated JSON
    allEvents.push(
      ...mapStreamEvent(
        { type: "content_block_stop", index: 0 },
        null,
        state,
      ),
    )

    const types = allEvents.map((e) => e.type)
    expect(types).toEqual([
      "turn_start",
      "tool_use_start",
      "tool_use_progress", // parsed input
    ])

    // Verify the parsed input
    const progress = allEvents.find(
      (e) => e.type === "tool_use_progress",
    )
    expect(progress.input).toEqual({ command: "ls -la" })
    expect(progress.id).toBe("tool-1")
  })
})
