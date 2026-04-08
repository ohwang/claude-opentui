import { describe, expect, it } from "bun:test"
import type { AgentEvent } from "../../src/protocol/types"

/**
 * Adapter Contract Tests
 *
 * These tests validate event ordering rules that ALL adapters must follow.
 * Run against any AgentBackend implementation by feeding its event stream
 * through these validators.
 *
 * For now, we test the rules against manually-constructed event sequences.
 * When adapters exist, these become parameterized tests.
 */

// ---------------------------------------------------------------------------
// Contract validation functions (reusable across adapters)
// ---------------------------------------------------------------------------

type ContractViolation = {
  rule: string
  message: string
  eventIndex: number
  event: AgentEvent
}

/**
 * Validates a sequence of events against all adapter contract rules.
 * Returns an array of violations (empty = all rules pass).
 */
export function validateEventSequence(events: AgentEvent[]): ContractViolation[] {
  const violations: ContractViolation[] = []
  let seenSessionInit = false
  let inTurn = false
  let turnCount = 0
  const closed = false

  for (let i = 0; i < events.length; i++) {
    const event = events[i]!

    // Rule: No events after close
    if (closed) {
      violations.push({
        rule: "no_events_after_close",
        message: `Event ${event.type} received after close`,
        eventIndex: i,
        event,
      })
      continue
    }

    // Rule: session_init must be first event
    if (!seenSessionInit && event.type !== "session_init") {
      violations.push({
        rule: "session_init_first",
        message: `Expected session_init as first event, got ${event.type}`,
        eventIndex: i,
        event,
      })
    }

    if (event.type === "session_init") {
      if (seenSessionInit) {
        violations.push({
          rule: "session_init_once",
          message: "session_init emitted more than once",
          eventIndex: i,
          event,
        })
      }
      seenSessionInit = true
    }

    // Rule: turn_start must precede text_delta
    if (event.type === "text_delta" && !inTurn) {
      violations.push({
        rule: "turn_start_before_text",
        message: "text_delta received outside of a turn",
        eventIndex: i,
        event,
      })
    }

    // Rule: turn_start must precede thinking_delta
    if (event.type === "thinking_delta" && !inTurn) {
      violations.push({
        rule: "turn_start_before_thinking",
        message: "thinking_delta received outside of a turn",
        eventIndex: i,
        event,
      })
    }

    // Rule: tool events must be within a turn
    if (
      (event.type === "tool_use_start" ||
        event.type === "tool_use_progress" ||
        event.type === "tool_use_end") &&
      !inTurn
    ) {
      violations.push({
        rule: "tools_within_turn",
        message: `${event.type} received outside of a turn`,
        eventIndex: i,
        event,
      })
    }

    // Rule: permission_request must be within a turn
    if (event.type === "permission_request" && !inTurn) {
      violations.push({
        rule: "permission_within_turn",
        message: "permission_request received outside of a turn",
        eventIndex: i,
        event,
      })
    }

    // Track turn state
    if (event.type === "turn_start") {
      if (inTurn) {
        violations.push({
          rule: "no_nested_turns",
          message: "turn_start received while already in a turn",
          eventIndex: i,
          event,
        })
      }
      inTurn = true
      turnCount++
    }

    if (event.type === "turn_complete") {
      if (!inTurn) {
        violations.push({
          rule: "turn_complete_requires_turn",
          message: "turn_complete received without a preceding turn_start",
          eventIndex: i,
          event,
        })
      }
      inTurn = false
    }
  }

  // Rule: every turn_start must have a matching turn_complete
  if (inTurn) {
    violations.push({
      rule: "turn_must_complete",
      message: "Stream ended with an unclosed turn",
      eventIndex: events.length,
      event: { type: "turn_start" },
    })
  }

  return violations
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Adapter Contract: Event Ordering Rules", () => {
  it("valid sequence passes all rules", () => {
    const events: AgentEvent[] = [
      { type: "session_init", tools: [], models: [] },
      { type: "turn_start" },
      { type: "text_delta", text: "Hello" },
      { type: "text_complete", text: "Hello" },
      { type: "turn_complete" },
    ]
    expect(validateEventSequence(events)).toEqual([])
  })

  it("session_init must be the first event", () => {
    const events: AgentEvent[] = [
      { type: "turn_start" },
      { type: "session_init", tools: [], models: [] },
    ]
    const violations = validateEventSequence(events)
    expect(violations.some((v) => v.rule === "session_init_first")).toBe(true)
  })

  it("session_init must only appear once", () => {
    const events: AgentEvent[] = [
      { type: "session_init", tools: [], models: [] },
      { type: "session_init", tools: [], models: [] },
    ]
    const violations = validateEventSequence(events)
    expect(violations.some((v) => v.rule === "session_init_once")).toBe(true)
  })

  it("turn_start must precede text_delta", () => {
    const events: AgentEvent[] = [
      { type: "session_init", tools: [], models: [] },
      { type: "text_delta", text: "oops" },
    ]
    const violations = validateEventSequence(events)
    expect(violations.some((v) => v.rule === "turn_start_before_text")).toBe(
      true,
    )
  })

  it("turn_start must precede thinking_delta", () => {
    const events: AgentEvent[] = [
      { type: "session_init", tools: [], models: [] },
      { type: "thinking_delta", text: "thinking outside a turn" },
    ]
    const violations = validateEventSequence(events)
    expect(
      violations.some((v) => v.rule === "turn_start_before_thinking"),
    ).toBe(true)
  })

  it("turn_complete must follow every turn", () => {
    const events: AgentEvent[] = [
      { type: "session_init", tools: [], models: [] },
      { type: "turn_start" },
      { type: "text_delta", text: "hello" },
      // no turn_complete
    ]
    const violations = validateEventSequence(events)
    expect(violations.some((v) => v.rule === "turn_must_complete")).toBe(true)
  })

  it("no nested turns", () => {
    const events: AgentEvent[] = [
      { type: "session_init", tools: [], models: [] },
      { type: "turn_start" },
      { type: "turn_start" }, // nested
    ]
    const violations = validateEventSequence(events)
    expect(violations.some((v) => v.rule === "no_nested_turns")).toBe(true)
  })

  it("permission_request must be within a turn", () => {
    const events: AgentEvent[] = [
      { type: "session_init", tools: [], models: [] },
      {
        type: "permission_request",
        id: "p1",
        tool: "Bash",
        input: { cmd: "ls" },
      },
    ]
    const violations = validateEventSequence(events)
    expect(violations.some((v) => v.rule === "permission_within_turn")).toBe(
      true,
    )
  })

  it("tool events must be within a turn", () => {
    const events: AgentEvent[] = [
      { type: "session_init", tools: [], models: [] },
      {
        type: "tool_use_start",
        id: "t1",
        tool: "Read",
        input: { path: "/x" },
      },
    ]
    const violations = validateEventSequence(events)
    expect(violations.some((v) => v.rule === "tools_within_turn")).toBe(true)
  })

  it("turn_complete without turn_start is a violation", () => {
    const events: AgentEvent[] = [
      { type: "session_init", tools: [], models: [] },
      { type: "turn_complete" },
    ]
    const violations = validateEventSequence(events)
    expect(
      violations.some((v) => v.rule === "turn_complete_requires_turn"),
    ).toBe(true)
  })

  it("complex valid sequence with tools and permissions", () => {
    const events: AgentEvent[] = [
      { type: "session_init", tools: [{ name: "Read" }], models: [] },
      { type: "turn_start" },
      { type: "thinking_delta", text: "I should read the file" },
      { type: "text_delta", text: "Let me read " },
      {
        type: "tool_use_start",
        id: "t1",
        tool: "Read",
        input: { path: "/foo" },
      },
      { type: "tool_use_progress", id: "t1", output: "contents..." },
      { type: "tool_use_end", id: "t1", output: "full contents" },
      { type: "text_delta", text: "the file." },
      {
        type: "permission_request",
        id: "p1",
        tool: "Write",
        input: { path: "/bar" },
      },
      { type: "text_complete", text: "Let me read the file." },
      { type: "cost_update", inputTokens: 100, outputTokens: 50, cost: 0.01 },
      {
        type: "turn_complete",
        usage: { inputTokens: 100, outputTokens: 50 },
      },
    ]
    expect(validateEventSequence(events)).toEqual([])
  })

  it("multi-turn sequence is valid", () => {
    const events: AgentEvent[] = [
      { type: "session_init", tools: [], models: [] },
      // Turn 1
      { type: "turn_start" },
      { type: "text_delta", text: "Response 1" },
      { type: "text_complete", text: "Response 1" },
      { type: "turn_complete" },
      // Turn 2
      { type: "turn_start" },
      { type: "text_delta", text: "Response 2" },
      { type: "text_complete", text: "Response 2" },
      { type: "turn_complete" },
    ]
    expect(validateEventSequence(events)).toEqual([])
  })
})
