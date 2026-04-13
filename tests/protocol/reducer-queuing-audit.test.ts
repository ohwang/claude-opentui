/**
 * Reducer audit tests — message queuing bugbash (2026-04-13).
 *
 * Targets gaps identified by the audit brief:
 *   - double `turn_complete` is idempotent (doesn't double-unqueue, doesn't
 *     double-count cost, doesn't re-enter RUNNING).
 *   - `turn_complete` without a preceding `turn_start` is a no-op when state
 *     is IDLE, and recovers the session when state is ERROR.
 *   - assistant block ordering relative to mid-turn queued user blocks
 *     (regression-locks the flushBuffers insertion index).
 *   - `user_message` during every non-IDLE/ERROR state yields queued: true.
 *
 * The existing reducer.test.ts already covers the happy-path mid-turn
 * enqueue/dequeue cycle; this file adds the edge cases.
 */

import { describe, expect, it } from "bun:test"
import { reduce } from "../../src/protocol/reducer"
import {
  createInitialState,
  type AgentEvent,
  type Block,
  type ConversationState,
} from "../../src/protocol/types"

function applyEvents(events: AgentEvent[]): ConversationState {
  return events.reduce(
    (state, event) => reduce(state, event),
    createInitialState(),
  )
}

describe("Reducer queuing — audit", () => {
  describe("double turn_complete idempotency", () => {
    it("second turn_complete while IDLE is a no-op on blocks, state, cost", () => {
      const events: AgentEvent[] = [
        { type: "session_init", tools: [], models: [] },
        { type: "user_message", text: "hi" },
        { type: "turn_start" },
        { type: "text_delta", text: "hello" },
        {
          type: "turn_complete",
          usage: {
            inputTokens: 100,
            outputTokens: 10,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalCostUsd: 0.01,
          },
        },
      ]
      const once = applyEvents(events)
      const twice = applyEvents([
        ...events,
        // Duplicate turn_complete with same usage — must NOT double-count.
        {
          type: "turn_complete",
          usage: {
            inputTokens: 100,
            outputTokens: 10,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalCostUsd: 0.01,
          },
        },
      ])

      expect(twice.sessionState).toBe(once.sessionState)
      expect(twice.sessionState).toBe("IDLE")
      expect(twice.blocks.length).toBe(once.blocks.length)
      expect(twice.cost.totalCostUsd).toBe(once.cost.totalCostUsd)
      expect(twice.cost.inputTokens).toBe(once.cost.inputTokens)
      expect(twice.cost.outputTokens).toBe(once.cost.outputTokens)
    })

    it("second turn_complete does not re-unqueue blocks or double-flush", () => {
      const events: AgentEvent[] = [
        { type: "session_init", tools: [], models: [] },
        { type: "user_message", text: "start" },
        { type: "turn_start" },
        { type: "text_delta", text: "response" },
        { type: "user_message", text: "queued" },
        { type: "turn_complete" },
      ]
      const once = applyEvents(events)
      const twice = applyEvents([...events, { type: "turn_complete" }])

      expect(twice.blocks).toHaveLength(once.blocks.length)
      // The queued block is unqueued exactly once.
      const queuedBlock = twice.blocks.find(
        (b): b is Extract<Block, { type: "user" }> =>
          b.type === "user" && b.text === "queued",
      )
      expect(queuedBlock).toBeDefined()
      expect(queuedBlock!.queued).toBeUndefined()
    })
  })

  describe("turn_complete without preceding turn_start", () => {
    it("from IDLE is a no-op (state unchanged, no blocks added)", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_complete" },
      ])
      expect(state.sessionState).toBe("IDLE")
      // session_init is the only effect
      expect(state.blocks).toHaveLength(0)
      expect(state.turnNumber).toBe(0)
    })

    it("from INITIALIZING is a no-op (guard rejects the transition)", () => {
      const state = applyEvents([{ type: "turn_complete" }])
      expect(state.sessionState).toBe("INITIALIZING")
      expect(state.blocks).toHaveLength(0)
    })

    it("from ERROR recovers to IDLE (documented recovery path)", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "error", code: "adapter_error", message: "boom", severity: "fatal" },
        { type: "turn_complete" },
      ])
      expect(state.sessionState).toBe("IDLE")
    })
  })

  describe("assistant block ordering with queued user messages", () => {
    it("flushing mid-turn streaming text inserts BEFORE queued user blocks", () => {
      // Sequence: turn_start, streaming text, user queues mid-stream,
      // tool_use_start triggers flush — the assistant block must be inserted
      // before the queued user block to preserve chronological order.
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "text_delta", text: "thinking out loud" },
        { type: "user_message", text: "queued during stream" },
        { type: "tool_use_start", id: "t1", tool: "Read", input: {} },
      ])

      // Must appear: [assistant, user(queued), tool]
      // Not: [user(queued), assistant, tool]
      const types = state.blocks.map((b) => b.type)
      expect(types).toEqual(["assistant", "user", "tool"])
      const userBlock = state.blocks[1] as Extract<Block, { type: "user" }>
      expect(userBlock.queued).toBe(true)
    })

    it("flushing with multiple queued user blocks inserts before the FIRST queued block", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "text_delta", text: "partial" },
        { type: "user_message", text: "q1" },
        { type: "user_message", text: "q2" },
        { type: "text_delta", text: " more" }, // buffer keeps growing
        { type: "tool_use_start", id: "t1", tool: "Read", input: {} },
      ])
      // [assistant("partial more"), user(q1), user(q2), tool]
      expect(state.blocks.map((b) => b.type)).toEqual([
        "assistant",
        "user",
        "user",
        "tool",
      ])
      expect((state.blocks[0] as Extract<Block, { type: "assistant" }>).text).toBe(
        "partial more",
      )
    })

    it("thinking flush is inserted before queued blocks along with text", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "thinking_delta", text: "reasoning..." },
        { type: "text_delta", text: "speaking..." },
        { type: "user_message", text: "queued" },
        { type: "tool_use_start", id: "t1", tool: "Read", input: {} },
      ])
      // thinking and text both flush, thinking first
      expect(state.blocks.map((b) => b.type)).toEqual([
        "thinking",
        "assistant",
        "user",
        "tool",
      ])
    })
  })

  describe("user_message queuing across non-IDLE states", () => {
    it("queues during RUNNING", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "user_message", text: "q" },
      ])
      const last = state.blocks.at(-1) as Extract<Block, { type: "user" }>
      expect(last.queued).toBe(true)
    })

    it("queues during INTERRUPTING", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "interrupt" },
        { type: "user_message", text: "q" },
      ])
      const last = state.blocks.at(-1) as Extract<Block, { type: "user" }>
      expect(last.queued).toBe(true)
    })

    it("queues during WAITING_FOR_ELIC", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "elicitation_request",
          id: "e1",
          questions: [{ question: "go?", options: [{ label: "yes" }, { label: "no" }] }],
        },
        { type: "user_message", text: "q" },
      ])
      const last = state.blocks.at(-1) as Extract<Block, { type: "user" }>
      expect(last.queued).toBe(true)
    })

    it("does NOT queue during ERROR — auto-recovers", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "error", code: "x", message: "boom", severity: "fatal" },
        { type: "user_message", text: "fresh start" },
      ])
      const userBlock = state.blocks.find(
        (b): b is Extract<Block, { type: "user" }> =>
          b.type === "user" && b.text === "fresh start",
      )
      expect(userBlock).toBeDefined()
      expect(userBlock!.queued).toBeUndefined()
      expect(state.sessionState).toBe("IDLE")
    })
  })

  describe("turn_complete drains all queued blocks atomically", () => {
    it("unqueues N user blocks in one reducer step", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "user_message", text: "a" },
        { type: "user_message", text: "b" },
        { type: "user_message", text: "c" },
        { type: "turn_complete" },
      ])
      const queueds = state.blocks.filter(
        (b) => b.type === "user" && (b as Extract<Block, { type: "user" }>).queued,
      )
      expect(queueds).toHaveLength(0)
    })
  })
})
