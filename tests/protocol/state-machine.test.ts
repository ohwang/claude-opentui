import { describe, expect, it } from "bun:test"
import { reduce } from "../../src/protocol/reducer"
import {
  createInitialState,
  type AgentEvent,
  type ConversationState,
} from "../../src/protocol/types"

function applyEvents(events: AgentEvent[]): ConversationState {
  return events.reduce(
    (state, event) => reduce(state, event),
    createInitialState(),
  )
}

describe("State Machine Transitions", () => {
  // -----------------------------------------------------------------------
  // Happy path: INITIALIZING → IDLE → RUNNING → IDLE
  // -----------------------------------------------------------------------

  it("INITIALIZING → IDLE via session_init", () => {
    const state = applyEvents([
      { type: "session_init", tools: [], models: [] },
    ])
    expect(state.sessionState).toBe("IDLE")
  })

  it("IDLE → RUNNING via turn_start", () => {
    const state = applyEvents([
      { type: "session_init", tools: [], models: [] },
      { type: "turn_start" },
    ])
    expect(state.sessionState).toBe("RUNNING")
  })

  it("RUNNING → IDLE via turn_complete", () => {
    const state = applyEvents([
      { type: "session_init", tools: [], models: [] },
      { type: "turn_start" },
      { type: "turn_complete" },
    ])
    expect(state.sessionState).toBe("IDLE")
  })

  // -----------------------------------------------------------------------
  // Permission flow: RUNNING → WAITING_FOR_PERM → RUNNING
  // -----------------------------------------------------------------------

  it("RUNNING → WAITING_FOR_PERM via permission_request", () => {
    const state = applyEvents([
      { type: "session_init", tools: [], models: [] },
      { type: "turn_start" },
      {
        type: "permission_request",
        id: "p1",
        tool: "Bash",
        input: { command: "ls" },
      },
    ])
    expect(state.sessionState).toBe("WAITING_FOR_PERM")
    expect(state.pendingPermission).not.toBeNull()
    expect(state.pendingPermission!.tool).toBe("Bash")
  })

  // -----------------------------------------------------------------------
  // Elicitation flow: RUNNING → WAITING_FOR_ELIC → RUNNING
  // -----------------------------------------------------------------------

  it("RUNNING → WAITING_FOR_ELIC via elicitation_request", () => {
    const state = applyEvents([
      { type: "session_init", tools: [], models: [] },
      { type: "turn_start" },
      {
        type: "elicitation_request",
        id: "e1",
        questions: [
          {
            question: "Pick one",
            options: [{ label: "A" }],
          },
        ],
      },
    ])
    expect(state.sessionState).toBe("WAITING_FOR_ELIC")
    expect(state.pendingElicitation).not.toBeNull()
  })

  it("WAITING_FOR_ELIC → RUNNING via elicitation_response", () => {
    const state = applyEvents([
      { type: "session_init", tools: [], models: [] },
      { type: "turn_start" },
      {
        type: "elicitation_request",
        id: "e1",
        questions: [
          {
            question: "Pick one",
            options: [{ label: "A" }],
          },
        ],
      },
      { type: "elicitation_response", id: "e1", answers: { "0": "a" } },
    ])
    expect(state.sessionState).toBe("RUNNING")
    expect(state.pendingElicitation).toBeNull()
  })

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  it("fatal error → ERROR state", () => {
    const state = applyEvents([
      { type: "session_init", tools: [], models: [] },
      { type: "turn_start" },
      {
        type: "error",
        code: "crash",
        message: "Something broke",
        severity: "fatal",
      },
    ])
    expect(state.sessionState).toBe("ERROR")
    expect(state.lastError!.code).toBe("crash")
  })

  it("recoverable error stays in current state", () => {
    const state = applyEvents([
      { type: "session_init", tools: [], models: [] },
      { type: "turn_start" },
      {
        type: "error",
        code: "rate_limit",
        message: "Slow down",
        severity: "recoverable",
      },
    ])
    expect(state.sessionState).toBe("RUNNING")
  })

  // -----------------------------------------------------------------------
  // Multi-turn with tools
  // -----------------------------------------------------------------------

  it("full turn with tools: start → tool → text → complete", () => {
    const state = applyEvents([
      { type: "session_init", tools: [{ name: "Read" }], models: [] },
      { type: "turn_start" },
      { type: "thinking_delta", text: "I should read the file" },
      {
        type: "tool_use_start",
        id: "t1",
        tool: "Read",
        input: { path: "/foo" },
      },
      { type: "tool_use_progress", id: "t1", output: "reading..." },
      { type: "tool_use_end", id: "t1", output: "file contents here" },
      { type: "text_delta", text: "I read the file." },
      { type: "text_complete", text: "I read the file." },
      {
        type: "turn_complete",
        usage: { inputTokens: 200, outputTokens: 80 },
      },
    ])

    expect(state.sessionState).toBe("IDLE")
    expect(state.turnNumber).toBe(1)
    // Blocks should contain thinking, tool, and text blocks
    expect(state.blocks.length).toBeGreaterThanOrEqual(1)
    expect(state.cost.inputTokens).toBe(200)
    expect(state.cost.outputTokens).toBe(80)
    expect(state.streamingText).toBe("")
    expect(state.streamingThinking).toBe("")
  })

  // -----------------------------------------------------------------------
  // Cost accumulation across turns
  // -----------------------------------------------------------------------

  it("cost accumulates across multiple turns", () => {
    const state = applyEvents([
      { type: "session_init", tools: [], models: [] },
      { type: "turn_start" },
      {
        type: "turn_complete",
        usage: { inputTokens: 100, outputTokens: 50, totalCostUsd: 0.005 },
      },
      { type: "turn_start" },
      {
        type: "turn_complete",
        usage: { inputTokens: 200, outputTokens: 75, totalCostUsd: 0.01 },
      },
    ])

    expect(state.cost.inputTokens).toBe(300)
    expect(state.cost.outputTokens).toBe(125)
    expect(state.cost.totalCostUsd).toBeCloseTo(0.015)
    expect(state.turnNumber).toBe(2)
  })

  // -----------------------------------------------------------------------
  // Task / subagent lifecycle
  // -----------------------------------------------------------------------

  it("task lifecycle: start → progress → complete", () => {
    const state = applyEvents([
      { type: "session_init", tools: [], models: [] },
      { type: "turn_start" },
      { type: "task_start", taskId: "t1", description: "Searching codebase" },
      { type: "task_progress", taskId: "t1", output: "Found 5 matches" },
      { type: "task_complete", taskId: "t1", output: "Done. 5 files." },
    ])

    expect(state.activeTasks.has("t1")).toBe(true)
    expect(state.activeTasks.get("t1")!.status).toBe("completed")
    expect(state.activeTasks.get("t1")!.output).toBe("Done. 5 files.")
  })

  // -----------------------------------------------------------------------
  // Duplicate/stale event handling
  // -----------------------------------------------------------------------

  it("duplicate turn_complete in IDLE is ignored", () => {
    const state = applyEvents([
      { type: "session_init", tools: [], models: [] },
      { type: "turn_start" },
      { type: "turn_complete" },
      { type: "turn_complete" }, // duplicate
    ])
    expect(state.sessionState).toBe("IDLE")
    expect(state.turnNumber).toBe(1) // not incremented
  })

  it("events before session_init don't crash", () => {
    const state = applyEvents([
      { type: "text_delta", text: "premature" },
      { type: "turn_complete" },
    ])
    expect(state.sessionState).toBe("INITIALIZING")
  })
})
