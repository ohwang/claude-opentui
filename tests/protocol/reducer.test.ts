import { describe, expect, it } from "bun:test"
import { reduce } from "../../src/protocol/reducer"
import {
  createInitialState,
  type AgentEvent,
  type ConversationState,
} from "../../src/protocol/types"

// Helper: apply a sequence of events to initial state
function applyEvents(events: AgentEvent[]): ConversationState {
  return events.reduce(
    (state, event) => reduce(state, event),
    createInitialState(),
  )
}

describe("ConversationState reducer", () => {
  // -----------------------------------------------------------------------
  // Session lifecycle
  // -----------------------------------------------------------------------

  describe("session_init", () => {
    it("transitions from INITIALIZING to IDLE", () => {
      const state = applyEvents([
        {
          type: "session_init",
          tools: [{ name: "Read" }, { name: "Write" }],
          models: [{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" }],
        },
      ])
      expect(state.sessionState).toBe("IDLE")
      expect(state.session).not.toBeNull()
      expect(state.session!.tools).toHaveLength(2)
      expect(state.session!.models).toHaveLength(1)
    })

    it("stores account info when provided", () => {
      const state = applyEvents([
        {
          type: "session_init",
          tools: [],
          models: [],
          account: { email: "test@example.com", plan: "pro" },
        },
      ])
      expect(state.session!.account?.email).toBe("test@example.com")
    })
  })

  // -----------------------------------------------------------------------
  // Turn lifecycle
  // -----------------------------------------------------------------------

  describe("turn_start", () => {
    it("transitions from IDLE to RUNNING", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
      ])
      expect(state.sessionState).toBe("RUNNING")
    })

    it("increments turn number", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
      ])
      expect(state.turnNumber).toBe(1)
    })
  })

  describe("turn_complete", () => {
    it("transitions from RUNNING to IDLE", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "turn_complete" },
      ])
      expect(state.sessionState).toBe("IDLE")
    })

    it("clears streaming text", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "text_delta", text: "hello" },
        { type: "turn_complete" },
      ])
      expect(state.streamingText).toBe("")
    })

    it("updates cost totals when usage provided", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "turn_complete",
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 10,
            totalCostUsd: 0.005,
          },
        },
      ])
      expect(state.cost.inputTokens).toBe(100)
      expect(state.cost.outputTokens).toBe(50)
      expect(state.cost.cacheReadTokens).toBe(10)
      expect(state.cost.totalCostUsd).toBe(0.005)
    })

    it("finalizes streaming text into a message", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "text_delta", text: "Hello " },
        { type: "text_delta", text: "world" },
        { type: "turn_complete" },
      ])
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0].role).toBe("assistant")
      expect(state.messages[0].content[0]).toEqual({
        type: "text",
        text: "Hello world",
      })
    })

    it("ignores duplicate turn_complete", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "turn_complete" },
        { type: "turn_complete" }, // duplicate
      ])
      expect(state.sessionState).toBe("IDLE")
      expect(state.turnNumber).toBe(1) // not incremented by duplicate
    })
  })

  // -----------------------------------------------------------------------
  // User messages
  // -----------------------------------------------------------------------

  describe("user_message", () => {
    it("adds a user message to the messages array", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "user_message", text: "Hello, world!" },
      ])
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0].role).toBe("user")
      expect(state.messages[0].content).toEqual([
        { type: "text", text: "Hello, world!" },
      ])
    })

    it("preserves existing messages when adding user message", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "user_message", text: "First" },
        { type: "turn_start" },
        { type: "text_complete", text: "Response" },
        { type: "turn_complete" },
        { type: "user_message", text: "Second" },
      ])
      expect(state.messages).toHaveLength(3)
      expect(state.messages[0].role).toBe("user")
      expect(state.messages[1].role).toBe("assistant")
      expect(state.messages[2].role).toBe("user")
    })
  })

  // -----------------------------------------------------------------------
  // Interrupt
  // -----------------------------------------------------------------------

  describe("interrupt", () => {
    it("transitions RUNNING to INTERRUPTING", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "interrupt" },
      ])
      expect(state.sessionState).toBe("INTERRUPTING")
    })

    it("does not change state when IDLE", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "interrupt" },
      ])
      expect(state.sessionState).toBe("IDLE")
    })
  })

  // -----------------------------------------------------------------------
  // System messages
  // -----------------------------------------------------------------------

  describe("system_message", () => {
    it("adds system message to messages array", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "system_message", text: "Command output here" },
      ])
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0].role).toBe("system")
      expect(state.messages[0].content).toEqual([
        { type: "text", text: "Command output here" },
      ])
    })
  })

  // -----------------------------------------------------------------------
  // Text streaming
  // -----------------------------------------------------------------------

  describe("text_delta", () => {
    it("accumulates streaming text", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "text_delta", text: "Hello " },
        { type: "text_delta", text: "world" },
      ])
      expect(state.streamingText).toBe("Hello world")
    })
  })

  describe("thinking_delta", () => {
    it("accumulates streaming thinking", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "thinking_delta", text: "Let me " },
        { type: "thinking_delta", text: "think..." },
      ])
      expect(state.streamingThinking).toBe("Let me think...")
    })
  })

  describe("text_complete", () => {
    it("creates an assistant message", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "text_complete", text: "Hello world" },
      ])
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0].role).toBe("assistant")
      expect(state.messages[0].content).toEqual([
        { type: "text", text: "Hello world" },
      ])
    })

    it("clears streaming text", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "text_delta", text: "partial" },
        { type: "text_complete", text: "full text" },
      ])
      expect(state.streamingText).toBe("")
    })
  })

  // -----------------------------------------------------------------------
  // Tool lifecycle
  // -----------------------------------------------------------------------

  describe("tool_use_start", () => {
    it("adds to active tools", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "tool_use_start",
          id: "tool1",
          tool: "Read",
          input: { path: "/foo" },
        },
      ])
      expect(state.activeTools.has("tool1")).toBe(true)
      expect(state.activeTools.get("tool1")!.tool).toBe("Read")
    })
  })

  describe("tool_use_progress", () => {
    it("appends output to active tool", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "tool_use_start",
          id: "tool1",
          tool: "Read",
          input: { path: "/foo" },
        },
        { type: "tool_use_progress", id: "tool1", output: "line 1\n" },
        { type: "tool_use_progress", id: "tool1", output: "line 2\n" },
      ])
      expect(state.activeTools.get("tool1")!.output).toBe("line 1\nline 2\n")
    })
  })

  describe("tool_use_end", () => {
    it("moves tool from active to completed", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "tool_use_start",
          id: "tool1",
          tool: "Read",
          input: { path: "/foo" },
        },
        { type: "tool_use_end", id: "tool1", output: "file contents" },
      ])
      expect(state.activeTools.has("tool1")).toBe(false)
      expect(state.completedTools).toHaveLength(1)
      expect(state.completedTools[0].output).toBe("file contents")
    })

    it("preserves error on tool failure", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "tool_use_start",
          id: "tool1",
          tool: "Read",
          input: { path: "/nonexistent" },
        },
        {
          type: "tool_use_end",
          id: "tool1",
          output: "",
          error: "File not found",
        },
      ])
      expect(state.completedTools[0].error).toBe("File not found")
    })
  })

  // -----------------------------------------------------------------------
  // Permission flow
  // -----------------------------------------------------------------------

  describe("permission_request", () => {
    it("transitions to WAITING_FOR_PERM", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "permission_request",
          id: "perm1",
          tool: "Bash",
          input: { command: "rm -rf /" },
        },
      ])
      expect(state.sessionState).toBe("WAITING_FOR_PERM")
      expect(state.pendingPermission).not.toBeNull()
      expect(state.pendingPermission!.id).toBe("perm1")
    })
  })

  // -----------------------------------------------------------------------
  // Elicitation flow
  // -----------------------------------------------------------------------

  describe("elicitation_request", () => {
    it("transitions to WAITING_FOR_ELIC", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "elicitation_request",
          id: "elic1",
          questions: [
            {
              question: "Which option?",
              options: [
                { label: "A", value: "a" },
                { label: "B", value: "b" },
              ],
            },
          ],
        },
      ])
      expect(state.sessionState).toBe("WAITING_FOR_ELIC")
      expect(state.pendingElicitation).not.toBeNull()
    })
  })

  describe("elicitation_response", () => {
    it("clears pending elicitation and returns to RUNNING", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "elicitation_request",
          id: "elic1",
          questions: [
            {
              question: "Which?",
              options: [{ label: "A", value: "a" }],
            },
          ],
        },
        {
          type: "elicitation_response",
          id: "elic1",
          answers: { "0": "a" },
        },
      ])
      expect(state.sessionState).toBe("RUNNING")
      expect(state.pendingElicitation).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  describe("error", () => {
    it("fatal error transitions to ERROR state", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "error",
          code: "error_max_turns",
          message: "Too many turns",
          severity: "fatal",
        },
      ])
      expect(state.sessionState).toBe("ERROR")
      expect(state.lastError).not.toBeNull()
      expect(state.lastError!.code).toBe("error_max_turns")
    })

    it("recoverable error stays in current state", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "error",
          code: "rate_limit",
          message: "Rate limited",
          severity: "recoverable",
        },
      ])
      expect(state.sessionState).toBe("RUNNING")
    })

    it("error without severity defaults to fatal", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "error",
          code: "unknown",
          message: "Something broke",
        },
      ])
      expect(state.sessionState).toBe("ERROR")
    })
  })

  // -----------------------------------------------------------------------
  // Cost tracking
  // -----------------------------------------------------------------------

  describe("cost_update", () => {
    it("accumulates cost totals", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "cost_update",
          inputTokens: 100,
          outputTokens: 50,
          cost: 0.005,
        },
        {
          type: "cost_update",
          inputTokens: 200,
          outputTokens: 75,
          cost: 0.01,
        },
      ])
      expect(state.cost.inputTokens).toBe(300)
      expect(state.cost.outputTokens).toBe(125)
      expect(state.cost.totalCostUsd).toBeCloseTo(0.015)
    })
  })

  // -----------------------------------------------------------------------
  // Task / subagent events
  // -----------------------------------------------------------------------

  describe("task_start", () => {
    it("adds to active tasks", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "task_start", taskId: "t1", description: "Searching files" },
      ])
      expect(state.activeTasks.has("t1")).toBe(true)
      expect(state.activeTasks.get("t1")!.description).toBe("Searching files")
    })
  })

  describe("task_progress", () => {
    it("updates task output", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "task_start", taskId: "t1", description: "Searching" },
        { type: "task_progress", taskId: "t1", output: "Found 3 matches" },
      ])
      expect(state.activeTasks.get("t1")!.output).toBe("Found 3 matches")
    })
  })

  describe("task_complete", () => {
    it("marks task as completed", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "task_start", taskId: "t1", description: "Searching" },
        { type: "task_complete", taskId: "t1", output: "Done" },
      ])
      expect(state.activeTasks.get("t1")!.status).toBe("completed")
    })
  })

  // -----------------------------------------------------------------------
  // Compact
  // -----------------------------------------------------------------------

  describe("compact", () => {
    it("adds compact message", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "compact", summary: "Conversation was compacted" },
      ])
      const compactMsg = state.messages.find(
        (m) => m.content[0]?.type === "compact",
      )
      expect(compactMsg).toBeDefined()
    })
  })

  // -----------------------------------------------------------------------
  // Backend-specific events
  // -----------------------------------------------------------------------

  describe("backend_specific", () => {
    it("is recorded in event log but does not change state", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        {
          type: "backend_specific",
          backend: "claude",
          data: { hook: "PreToolUse" },
        },
      ])
      expect(state.eventLog).toHaveLength(2) // session_init + backend_specific
    })
  })

  // -----------------------------------------------------------------------
  // Event log invariant
  // -----------------------------------------------------------------------

  describe("event log invariant", () => {
    it("every event is recorded in eventLog", () => {
      const events: AgentEvent[] = [
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "text_delta", text: "hi" },
        { type: "text_complete", text: "hi" },
        { type: "turn_complete" },
      ]
      const state = applyEvents(events)
      expect(state.eventLog).toHaveLength(events.length)
    })

    it("state is reconstructable from event log (tape replay)", () => {
      const events: AgentEvent[] = [
        { type: "session_init", tools: [{ name: "Read" }], models: [] },
        { type: "turn_start" },
        { type: "text_delta", text: "Hello " },
        { type: "text_delta", text: "world" },
        {
          type: "tool_use_start",
          id: "t1",
          tool: "Read",
          input: { path: "/x" },
        },
        { type: "tool_use_end", id: "t1", output: "contents" },
        { type: "text_complete", text: "Hello world" },
        {
          type: "turn_complete",
          usage: { inputTokens: 100, outputTokens: 50 },
        },
      ]

      // Apply all at once
      const state1 = applyEvents(events)

      // Replay from event log
      const state2 = state1.eventLog.reduce(
        (s, e) => reduce(s, e),
        createInitialState(),
      )

      // States should match (except Maps need special comparison)
      expect(state2.sessionState).toBe(state1.sessionState)
      expect(state2.messages).toEqual(state1.messages)
      expect(state2.cost).toEqual(state1.cost)
      expect(state2.turnNumber).toBe(state1.turnNumber)
    })
  })

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe("edge cases", () => {
    it("events before session_init stay in INITIALIZING", () => {
      const state = applyEvents([{ type: "text_delta", text: "premature" }])
      expect(state.sessionState).toBe("INITIALIZING")
    })

    it("unknown event type does not crash", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "unknown_event" } as any,
      ])
      expect(state.sessionState).toBe("IDLE")
    })

    it("session_state event is recorded but state machine takes precedence", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "session_state", state: "running" },
      ])
      // session_state is informational, doesn't override our state machine
      expect(state.eventLog).toHaveLength(2)
    })
  })
})
