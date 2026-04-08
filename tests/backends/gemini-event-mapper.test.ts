import { describe, expect, it } from "bun:test"
import { mapGeminiEvent, GeminiEventMapper } from "../../src/backends/gemini/event-mapper"
import { GeminiEventType, type ServerGeminiStreamEvent } from "../../src/backends/gemini/types"

describe("Gemini Event Mapper", () => {
  describe("content streaming", () => {
    it("maps Content to text_delta", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.Content,
        value: "Hello, ",
      })
      expect(events).toHaveLength(1)
      expect(events[0]!).toEqual({ type: "text_delta", text: "Hello, " })
    })

    it("skips empty content", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.Content,
        value: "",
      })
      expect(events).toHaveLength(0)
    })
  })

  describe("thinking", () => {
    it("maps Thought to thinking_delta", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.Thought,
        value: { thought: "Let me analyze this..." },
      })
      expect(events).toHaveLength(1)
      expect(events[0]!).toEqual({
        type: "thinking_delta",
        text: "Let me analyze this...",
      })
    })

    it("skips empty thought", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.Thought,
        value: { thought: "" },
      })
      expect(events).toHaveLength(0)
    })
  })

  describe("tool calls", () => {
    it("maps ToolCallRequest to tool_use_start", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.ToolCallRequest,
        value: {
          callId: "call-1",
          name: "shell",
          args: { command: "ls -la" },
        },
      })
      expect(events).toHaveLength(1)
      const start = events[0]! as any
      expect(start.type).toBe("tool_use_start")
      expect(start.id).toBe("call-1")
      expect(start.tool).toBe("shell")
      expect(start.input).toEqual({ command: "ls -la" })
    })

    it("maps ToolCallResponse success to tool_use_end", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.ToolCallResponse,
        value: {
          callId: "call-1",
          responseParts: [{ text: "file1.ts\nfile2.ts\n" }],
          resultDisplay: undefined,
          error: undefined,
          errorType: undefined,
        },
      })
      expect(events).toHaveLength(1)
      const end = events[0]! as any
      expect(end.type).toBe("tool_use_end")
      expect(end.id).toBe("call-1")
      expect(end.output).toBe("file1.ts\nfile2.ts\n")
      expect(end.error).toBeUndefined()
    })

    it("maps ToolCallResponse with error to tool_use_end with error", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.ToolCallResponse,
        value: {
          callId: "call-2",
          responseParts: [],
          resultDisplay: undefined,
          error: new Error("Command not found"),
          errorType: "execution_error",
        },
      })
      expect(events).toHaveLength(1)
      const end = events[0]! as any
      expect(end.type).toBe("tool_use_end")
      expect(end.error).toBe("Command not found")
    })

    it("maps ToolCallResponse with data fallback", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.ToolCallResponse,
        value: {
          callId: "call-3",
          responseParts: [],
          resultDisplay: undefined,
          error: undefined,
          errorType: undefined,
          data: { result: "some data" },
        },
      })
      expect(events).toHaveLength(1)
      const end = events[0]! as any
      expect(end.output).toBe('{"result":"some data"}')
    })

    it("maps ToolCallConfirmation as backend_specific", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.ToolCallConfirmation,
        value: {
          callId: "call-1",
          name: "shell",
          args: { command: "rm -rf /" },
          decision: "deny",
        },
      })
      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe("backend_specific")
      expect((events[0]! as any).backend).toBe("gemini")
    })
  })

  describe("turn lifecycle", () => {
    it("maps Finished to cost_update + turn_complete with usage", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.Finished,
        value: {
          reason: "STOP",
          usageMetadata: {
            promptTokenCount: 100,
            candidatesTokenCount: 50,
            cachedContentTokenCount: 10,
          },
        },
      })
      expect(events).toHaveLength(2)
      // First event: cost_update for running token totals
      const costUpdate = events[0]! as any
      expect(costUpdate.type).toBe("cost_update")
      expect(costUpdate.inputTokens).toBe(100)
      expect(costUpdate.outputTokens).toBe(50)
      expect(costUpdate.cacheReadTokens).toBe(10)
      // Second event: turn_complete with authoritative usage
      const complete = events[1]! as any
      expect(complete.type).toBe("turn_complete")
      expect(complete.usage.inputTokens).toBe(100)
      expect(complete.usage.outputTokens).toBe(50)
      expect(complete.usage.cacheReadTokens).toBe(10)
    })

    it("maps Finished without usage metadata", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.Finished,
        value: { reason: "STOP", usageMetadata: undefined },
      })
      expect(events).toHaveLength(1)
      expect((events[0]! as any).usage).toBeUndefined()
    })
  })

  describe("errors", () => {
    it("maps Error event with Error object", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.Error,
        value: { error: new Error("API rate limit") },
      })
      expect(events).toHaveLength(1)
      const err = events[0]! as any
      expect(err.type).toBe("error")
      expect(err.code).toBe("gemini_error")
      expect(err.message).toBe("API rate limit")
    })

    it("maps Error event with string error", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.Error,
        value: { error: "Something went wrong" },
      })
      expect(events).toHaveLength(1)
      expect((events[0]! as any).message).toBe("Something went wrong")
    })
  })

  describe("model info", () => {
    it("maps ModelInfo to session_init", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.ModelInfo,
        value: "gemini-2.5-pro",
      })
      expect(events).toHaveLength(1)
      const init = events[0]! as any
      expect(init.type).toBe("session_init")
      expect(init.models).toHaveLength(1)
      expect(init.models[0].id).toBe("gemini-2.5-pro")
      expect(init.models[0].provider).toBe("google")
    })
  })

  describe("compaction", () => {
    it("maps ChatCompressed to compact", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.ChatCompressed,
        value: null,
      })
      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe("compact")
    })
  })

  describe("limit events", () => {
    it("maps MaxSessionTurns to fatal error", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.MaxSessionTurns,
      })
      expect(events).toHaveLength(1)
      const err = events[0]! as any
      expect(err.type).toBe("error")
      expect(err.code).toBe("max_turns")
      expect(err.severity).toBe("fatal")
    })

    it("maps LoopDetected to recoverable error", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.LoopDetected,
      })
      expect(events).toHaveLength(1)
      const err = events[0]! as any
      expect(err.type).toBe("error")
      expect(err.code).toBe("loop_detected")
      expect(err.severity).toBe("recoverable")
    })

    it("maps InvalidStream to error", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.InvalidStream,
      })
      expect(events).toHaveLength(1)
      expect((events[0]! as any).code).toBe("invalid_stream")
    })
  })

  describe("execution control", () => {
    it("maps AgentExecutionStopped to system_message + error", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.AgentExecutionStopped,
        value: {
          reason: "safety_filter",
          systemMessage: "Content was filtered for safety.",
        },
      })
      expect(events).toHaveLength(2)
      expect(events[0]!.type).toBe("system_message")
      expect((events[0]! as any).text).toBe("Content was filtered for safety.")
      expect(events[1]!.type).toBe("error")
      expect((events[1]! as any).code).toBe("execution_stopped")
    })

    it("maps AgentExecutionBlocked to system_message + error", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.AgentExecutionBlocked,
        value: {
          reason: "blocked_by_policy",
        },
      })
      expect(events).toHaveLength(1) // no systemMessage
      expect(events[0]!.type).toBe("error")
      expect((events[0]! as any).code).toBe("execution_blocked")
    })
  })

  describe("informational events", () => {
    it("maps Citation to system_message", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.Citation,
        value: "Source: https://example.com",
      })
      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe("system_message")
      expect((events[0]! as any).text).toBe("Source: https://example.com")
    })

    it("maps ContextWindowWillOverflow as backend_specific", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.ContextWindowWillOverflow,
        value: {
          estimatedRequestTokenCount: 900000,
          remainingTokenCount: 100000,
        },
      })
      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe("backend_specific")
      expect((events[0]! as any).backend).toBe("gemini")
    })

    it("UserCancelled produces no events", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.UserCancelled,
      })
      expect(events).toHaveLength(0)
    })

    it("Retry produces no events", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.Retry,
      })
      expect(events).toHaveLength(0)
    })
  })

  describe("text_complete (stateful mapper)", () => {
    it("emits text_complete with accumulated text on Finished", () => {
      const mapper = new GeminiEventMapper()

      // Simulate two Content events
      mapper.map({ type: GeminiEventType.Content, value: "Hello, " })
      mapper.map({ type: GeminiEventType.Content, value: "world!" })

      // Finished should emit text_complete -> cost_update -> turn_complete
      const events = mapper.map({
        type: GeminiEventType.Finished,
        value: {
          reason: "STOP",
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            cachedContentTokenCount: 0,
          },
        },
      })

      expect(events).toHaveLength(3)
      expect(events[0]!).toEqual({ type: "text_complete", text: "Hello, world!" })
      expect(events[1]!.type).toBe("cost_update")
      expect(events[2]!.type).toBe("turn_complete")
    })

    it("does not emit text_complete when no text was accumulated", () => {
      const mapper = new GeminiEventMapper()

      const events = mapper.map({
        type: GeminiEventType.Finished,
        value: { reason: "STOP", usageMetadata: undefined },
      })

      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe("turn_complete")
    })

    it("resets accumulated text between turns", () => {
      const mapper = new GeminiEventMapper()

      // First turn
      mapper.map({ type: GeminiEventType.Content, value: "First turn text" })
      const firstFinish = mapper.map({
        type: GeminiEventType.Finished,
        value: { reason: "STOP", usageMetadata: undefined },
      })
      expect(firstFinish[0]!).toEqual({ type: "text_complete", text: "First turn text" })

      // Reset for second turn
      mapper.reset()

      // Second turn
      mapper.map({ type: GeminiEventType.Content, value: "Second turn" })
      const secondFinish = mapper.map({
        type: GeminiEventType.Finished,
        value: { reason: "STOP", usageMetadata: undefined },
      })
      expect(secondFinish[0]!).toEqual({ type: "text_complete", text: "Second turn" })
    })

    it("emits text_complete before cost_update and turn_complete", () => {
      const mapper = new GeminiEventMapper()

      mapper.map({ type: GeminiEventType.Content, value: "Some response" })
      const events = mapper.map({
        type: GeminiEventType.Finished,
        value: {
          reason: "STOP",
          usageMetadata: {
            promptTokenCount: 100,
            candidatesTokenCount: 50,
            cachedContentTokenCount: 10,
          },
        },
      })

      const types = events.map((e) => e.type)
      expect(types).toEqual(["text_complete", "cost_update", "turn_complete"])
    })
  })
})
