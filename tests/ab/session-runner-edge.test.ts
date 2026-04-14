/**
 * Extended event processing tests — covers edge cases not in the original
 * session-runner.test.ts suite.
 */

import { describe, expect, it } from "bun:test"
import { processEvent } from "../../src/ab/session-runner"
import type { SessionStats } from "../../src/ab/types"

const blankStats = (): SessionStats => ({
  label: "A",
  backendId: "mock",
  output: "",
  turns: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalCostUsd: 0,
  toolUseCount: 0,
  startTime: 0,
  filesTouched: [],
  complete: false,
  interrupted: false,
})

describe("processEvent edge cases", () => {
  it("handles multiple turn_complete events (multi-turn session)", () => {
    const s = blankStats()
    processEvent(
      { type: "turn_complete", usage: { inputTokens: 10, outputTokens: 20 } },
      s,
      "p",
    )
    processEvent(
      {
        type: "turn_complete",
        usage: { inputTokens: 50, outputTokens: 80, totalCostUsd: 0.01 },
      },
      s,
      "p",
    )
    expect(s.turns).toBe(2)
    // usage replaces (latest snapshot), not accumulates
    expect(s.inputTokens).toBe(50)
    expect(s.outputTokens).toBe(80)
    expect(s.totalCostUsd).toBe(0.01)
  })

  it("handles cost_update with null fields (partial updates)", () => {
    const s = blankStats()
    s.inputTokens = 100
    s.outputTokens = 50
    s.totalCostUsd = 0.005

    // Only cost provided, tokens unchanged via cost_update where we skip
    // the token fields by checking for null at runtime (the type says number,
    // but adapters may emit partial updates with undefined).
    processEvent(
      { type: "cost_update", inputTokens: undefined as any, outputTokens: undefined as any, cost: 0.001 },
      s,
      "p",
    )
    // Tokens should remain unchanged when fields are undefined
    expect(s.inputTokens).toBe(100)
    expect(s.outputTokens).toBe(50)
    expect(s.totalCostUsd).toBeCloseTo(0.006, 5)
  })

  it("handles tool_use_start with no input object", () => {
    const s = blankStats()
    processEvent(
      { type: "tool_use_start", id: "t1", tool: "Bash", input: undefined },
      s,
      "p",
    )
    expect(s.toolUseCount).toBe(1)
    expect(s.filesTouched).toEqual([])
  })

  it("handles tool_use_start with null input", () => {
    const s = blankStats()
    processEvent(
      { type: "tool_use_start", id: "t1", tool: "Bash", input: null },
      s,
      "p",
    )
    expect(s.toolUseCount).toBe(1)
    expect(s.filesTouched).toEqual([])
  })

  it("deduplicates file paths from multiple tool_use_start events", () => {
    const s = blankStats()
    processEvent(
      { type: "tool_use_start", id: "t1", tool: "Read", input: { file_path: "/a.ts" } },
      s,
      "p",
    )
    processEvent(
      { type: "tool_use_start", id: "t2", tool: "Edit", input: { file_path: "/a.ts" } },
      s,
      "p",
    )
    processEvent(
      { type: "tool_use_start", id: "t3", tool: "Write", input: { file_path: "/b.ts" } },
      s,
      "p",
    )
    expect(s.toolUseCount).toBe(3)
    expect(s.filesTouched).toEqual(["/a.ts", "/b.ts"])
  })

  it("does not crash on unknown event types", () => {
    const s = blankStats()
    // @ts-expect-error — testing unknown event type at runtime
    processEvent({ type: "some_future_event", data: 42 }, s, "p")
    // Stats unchanged
    expect(s.turns).toBe(0)
    expect(s.output).toBe("")
  })

  it("handles empty text_delta (zero-length string)", () => {
    const s = blankStats()
    processEvent({ type: "text_delta", text: "" }, s, "p")
    processEvent({ type: "text_delta", text: "hello" }, s, "p")
    processEvent({ type: "text_delta", text: "" }, s, "p")
    expect(s.output).toBe("hello")
  })

  it("handles turn_complete with no usage field", () => {
    const s = blankStats()
    s.inputTokens = 100
    s.outputTokens = 50
    // turn_complete without usage — should still bump turns
    processEvent({ type: "turn_complete" } as any, s, "p")
    expect(s.turns).toBe(1)
    // Tokens should remain unchanged when no usage provided
    expect(s.inputTokens).toBe(100)
    expect(s.outputTokens).toBe(50)
  })

  it("handles tool_use_start with 'filename' field", () => {
    const s = blankStats()
    processEvent(
      { type: "tool_use_start", id: "t1", tool: "Write", input: { filename: "/c.ts" } },
      s,
      "p",
    )
    expect(s.filesTouched).toEqual(["/c.ts"])
  })

  it("handles tool_use_start with numeric path (should not add)", () => {
    const s = blankStats()
    processEvent(
      { type: "tool_use_start", id: "t1", tool: "Bash", input: { path: 42 } },
      s,
      "p",
    )
    expect(s.filesTouched).toEqual([])
  })

  it("turn_start is a no-op", () => {
    const s = blankStats()
    processEvent({ type: "turn_start" }, s, "p")
    expect(s.turns).toBe(0)
    expect(s.output).toBe("")
  })
})
