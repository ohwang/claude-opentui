import { describe, it, expect } from "bun:test"
import { computeVisualLineCount } from "../../src/tui/components/input-area"

describe("computeVisualLineCount", () => {
  it("returns 1 for empty text", () => {
    expect(computeVisualLineCount("", 80)).toBe(1)
  })

  it("returns 1 for text shorter than width", () => {
    expect(computeVisualLineCount("hello", 80)).toBe(1)
  })

  it("returns 1 for text exactly at width", () => {
    expect(computeVisualLineCount("a".repeat(80), 80)).toBe(1)
  })

  it("returns 2 for text one char over width", () => {
    // This is the critical boundary test — was broken when prefix could shrink
    expect(computeVisualLineCount("a".repeat(81), 80)).toBe(2)
  })

  it("returns correct count for multiple wraps", () => {
    expect(computeVisualLineCount("a".repeat(240), 80)).toBe(3)
    expect(computeVisualLineCount("a".repeat(241), 80)).toBe(4)
  })

  it("handles explicit newlines", () => {
    expect(computeVisualLineCount("line1\nline2", 80)).toBe(2)
    expect(computeVisualLineCount("line1\nline2\nline3", 80)).toBe(3)
  })

  it("handles mixed newlines and wrapping", () => {
    // First line wraps (85 chars in 80-wide), second line fits
    expect(computeVisualLineCount("a".repeat(85) + "\n" + "b".repeat(20), 80)).toBe(3)
  })

  it("handles narrow widths", () => {
    expect(computeVisualLineCount("hello", 3)).toBe(2) // "hel" + "lo"
    expect(computeVisualLineCount("hi", 1)).toBe(2) // "h" + "i"
  })

  it("clamps width to minimum 1 to avoid division by zero", () => {
    expect(computeVisualLineCount("test", 0)).toBe(4) // width clamps to 1
    expect(computeVisualLineCount("test", -5)).toBe(4) // width clamps to 1
  })

  it("returns 2 at exact terminal boundary for typical terminal width", () => {
    // Simulate: terminal=120, prefix=2, paddingRight=1 → available=117
    const width = 117
    expect(computeVisualLineCount("a".repeat(117), width)).toBe(1)
    expect(computeVisualLineCount("a".repeat(118), width)).toBe(2)
  })
})
