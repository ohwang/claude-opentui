/**
 * Session runner unit tests.
 *
 * The interesting integration test — run two MockAdapters end-to-end
 * and confirm both complete with accumulated stats — lives in
 * orchestrator.test.ts. Here we cover the pure event → stats mapping.
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

describe("processEvent", () => {
  it("accumulates text_delta into output", () => {
    const s = blankStats()
    processEvent({ type: "text_delta", text: "hello " }, s, "p")
    processEvent({ type: "text_delta", text: "world" }, s, "p")
    expect(s.output).toBe("hello world")
  })

  it("uses text_complete as final output only if no deltas were seen", () => {
    const s = blankStats()
    processEvent({ type: "text_complete", text: "abc" }, s, "p")
    expect(s.output).toBe("abc")

    const s2 = blankStats()
    processEvent({ type: "text_delta", text: "partial" }, s2, "p")
    processEvent({ type: "text_complete", text: "partial final" }, s2, "p")
    // Keep the streamed transcript — don't double-count
    expect(s2.output).toBe("partial")
  })

  it("increments turns on turn_complete", () => {
    const s = blankStats()
    processEvent({ type: "turn_start" }, s, "p")
    processEvent({ type: "turn_complete", usage: { inputTokens: 10, outputTokens: 20 } }, s, "p")
    expect(s.turns).toBe(1)
    expect(s.inputTokens).toBe(10)
    expect(s.outputTokens).toBe(20)
  })

  it("accumulates cost_update cost", () => {
    const s = blankStats()
    processEvent({ type: "cost_update", inputTokens: 5, outputTokens: 5, cost: 0.001 }, s, "p")
    processEvent({ type: "cost_update", inputTokens: 10, outputTokens: 10, cost: 0.002 }, s, "p")
    expect(s.inputTokens).toBe(10)
    expect(s.outputTokens).toBe(10)
    expect(s.totalCostUsd).toBeCloseTo(0.003, 5)
  })

  it("tracks tool use count + file paths", () => {
    const s = blankStats()
    processEvent({
      type: "tool_use_start",
      id: "t1",
      tool: "Read",
      input: { file_path: "/src/foo.ts" },
    }, s, "p")
    processEvent({
      type: "tool_use_start",
      id: "t2",
      tool: "Edit",
      input: { path: "/src/foo.ts" }, // dedup same file
    }, s, "p")
    processEvent({
      type: "tool_use_start",
      id: "t3",
      tool: "Write",
      input: { file_path: "/src/bar.ts" },
    }, s, "p")
    expect(s.toolUseCount).toBe(3)
    expect(s.filesTouched).toEqual(["/src/foo.ts", "/src/bar.ts"])
  })

  it("stores fatal error messages", () => {
    const s = blankStats()
    processEvent(
      { type: "error", code: "fatal", message: "boom", severity: "fatal" },
      s,
      "p",
    )
    expect(s.error).toBe("boom")
  })

  it("ignores non-fatal errors", () => {
    const s = blankStats()
    processEvent(
      { type: "error", code: "hmm", message: "warn", severity: "recoverable" },
      s,
      "p",
    )
    expect(s.error).toBeUndefined()
  })
})
