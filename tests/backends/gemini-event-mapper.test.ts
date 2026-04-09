import { describe, expect, it } from "bun:test"
import { mapGeminiEvent, GeminiEventMapper } from "../../src/backends/gemini/event-mapper"
import { GeminiEventType } from "../../src/backends/gemini/types"

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
    it("maps Thought to thinking_delta with trailing newline", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.Thought,
        value: { subject: "", description: "Let me analyze this..." },
      })
      expect(events).toHaveLength(1)
      expect(events[0]!).toEqual({
        type: "thinking_delta",
        text: "Let me analyze this...\n",
      })
    })

    it("preserves existing trailing newline without doubling", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.Thought,
        value: { subject: "", description: "Already has newline\n" },
      })
      expect(events).toHaveLength(1)
      expect(events[0]!).toEqual({
        type: "thinking_delta",
        text: "Already has newline\n",
      })
    })

    it("maps Thought with subject to thinking_delta with bold header", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.Thought,
        value: { subject: "Planning", description: "the solution" },
      })
      expect(events).toHaveLength(1)
      expect(events[0]!).toEqual({
        type: "thinking_delta",
        text: "**Planning** the solution\n",
      })
    })

    it("skips empty thought", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.Thought,
        value: { subject: "", description: "" },
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
    it("maps Finished to cost_update (turn_complete emitted by adapter)", () => {
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
      // Only cost_update — turn_complete is emitted by the adapter after the
      // stream ends, not by the event mapper on each Finished event.
      expect(events).toHaveLength(1)
      const costUpdate = events[0]! as any
      expect(costUpdate.type).toBe("cost_update")
      expect(costUpdate.inputTokens).toBe(100)
      expect(costUpdate.outputTokens).toBe(50)
      expect(costUpdate.cacheReadTokens).toBe(10)
    })

    it("maps Finished without usage metadata to no events", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.Finished,
        value: { reason: "STOP", usageMetadata: undefined },
      })
      // No cost_update (no usage), no turn_complete (emitted by adapter)
      expect(events).toHaveLength(0)
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
    it("maps ModelInfo to model_changed only (no system_message)", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.ModelInfo,
        value: "gemini-2.5-pro",
      })
      expect(events).toHaveLength(1)
      const changed = events[0]! as any
      expect(changed.type).toBe("model_changed")
      expect(changed.model).toBe("gemini-2.5-pro")
    })

    it("produces no events for empty ModelInfo", () => {
      const events = mapGeminiEvent({
        type: GeminiEventType.ModelInfo,
        value: "",
      })
      expect(events).toHaveLength(0)
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

  describe("stateful mapper (no text_complete, no cross-turn dedup)", () => {
    it("does NOT emit text_complete on Finished (text already streamed via text_delta)", () => {
      const mapper = new GeminiEventMapper()

      // Simulate two Content events — each produces a text_delta
      const c1 = mapper.map({ type: GeminiEventType.Content, value: "Hello, " })
      expect(c1).toHaveLength(1)
      expect(c1[0]!).toEqual({ type: "text_delta", text: "Hello, " })

      const c2 = mapper.map({ type: GeminiEventType.Content, value: "world!" })
      expect(c2).toHaveLength(1)
      expect(c2[0]!).toEqual({ type: "text_delta", text: "world!" })

      // Finished should emit only cost_update (no text_complete, no turn_complete)
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

      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe("cost_update")
    })

    it("does not emit text_complete when no text was accumulated", () => {
      const mapper = new GeminiEventMapper()

      const events = mapper.map({
        type: GeminiEventType.Finished,
        value: { reason: "STOP", usageMetadata: undefined },
      })

      // No text accumulated + no usage = no events (turn_complete emitted by adapter)
      expect(events).toHaveLength(0)
    })

    it("resets accumulated text between user turns", () => {
      const mapper = new GeminiEventMapper()

      // First turn
      const c1 = mapper.map({ type: GeminiEventType.Content, value: "First turn text" })
      expect(c1[0]!).toEqual({ type: "text_delta", text: "First turn text" })
      const firstFinish = mapper.map({
        type: GeminiEventType.Finished,
        value: { reason: "STOP", usageMetadata: undefined },
      })
      // Finished without usage = no events (turn_complete emitted by adapter)
      expect(firstFinish).toHaveLength(0)

      // Reset for second user turn
      mapper.reset()

      // Second turn — new text should stream normally
      const c2 = mapper.map({ type: GeminiEventType.Content, value: "Second turn" })
      expect(c2[0]!).toEqual({ type: "text_delta", text: "Second turn" })
      const secondFinish = mapper.map({
        type: GeminiEventType.Finished,
        value: { reason: "STOP", usageMetadata: undefined },
      })
      // No usage = no events
      expect(secondFinish).toHaveLength(0)
    })

    it("Finished emits only cost_update (no text_complete, no turn_complete)", () => {
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
      expect(types).toEqual(["cost_update"])
    })

    it("emits all Content from each SDK internal turn (no cross-turn dedup)", () => {
      const mapper = new GeminiEventMapper()

      // SDK internal turn 1: Content → ToolCallRequest → Finished
      const c1 = mapper.map({ type: GeminiEventType.Content, value: "I'll check the directory." })
      expect(c1).toHaveLength(1)
      expect(c1[0]!).toEqual({ type: "text_delta", text: "I'll check the directory." })

      mapper.map({
        type: GeminiEventType.ToolCallRequest,
        value: { callId: "call-1", name: "list_directory", args: { dir_path: "." } },
      })
      mapper.map({
        type: GeminiEventType.ToolCallResponse,
        value: { callId: "call-1", responseParts: [{ text: "file.ts" }] },
      })
      mapper.map({
        type: GeminiEventType.Finished,
        value: { reason: "STOP", usageMetadata: undefined },
      })

      // SDK internal turn 2: fresh model output (the SDK makes a new API call,
      // it does NOT re-emit Content from the previous turn)
      const c2 = mapper.map({ type: GeminiEventType.Content, value: "Here are the results:" })
      expect(c2).toHaveLength(1)
      expect(c2[0]!).toEqual({ type: "text_delta", text: "Here are the results:" })
    })

    it("emits Content from multiple SDK internal turns without fragments", () => {
      const mapper = new GeminiEventMapper()

      // Turn 1: text + tool call
      mapper.map({ type: GeminiEventType.Content, value: "Let me list the files." })
      mapper.map({
        type: GeminiEventType.ToolCallRequest,
        value: { callId: "call-1", name: "list_directory", args: { dir_path: "src" } },
      })
      mapper.map({
        type: GeminiEventType.Finished,
        value: { reason: "STOP", usageMetadata: undefined },
      })

      // Turn 2: text + another tool call
      const c2 = mapper.map({ type: GeminiEventType.Content, value: "Now let me read the file." })
      expect(c2).toHaveLength(1)
      expect(c2[0]!).toEqual({ type: "text_delta", text: "Now let me read the file." })

      mapper.map({
        type: GeminiEventType.ToolCallRequest,
        value: { callId: "call-2", name: "read_file", args: { file_path: "src/index.ts" } },
      })
      mapper.map({
        type: GeminiEventType.Finished,
        value: { reason: "STOP", usageMetadata: undefined },
      })

      // Turn 3: final summary
      const c3 = mapper.map({ type: GeminiEventType.Content, value: "The directory contains the following:" })
      expect(c3).toHaveLength(1)
      expect(c3[0]!).toEqual({ type: "text_delta", text: "The directory contains the following:" })
    })
  })
})
