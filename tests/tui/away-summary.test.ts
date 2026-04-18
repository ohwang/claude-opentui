import { describe, expect, it } from "bun:test"
import { formatAwayDuration } from "../../src/frontends/tui/hooks/useAwaySummary"

describe("formatAwayDuration", () => {
  it("formats durations under 1 hour as minutes", () => {
    expect(formatAwayDuration(3 * 60_000)).toBe("3m")
    expect(formatAwayDuration(15 * 60_000)).toBe("15m")
    expect(formatAwayDuration(59 * 60_000)).toBe("59m")
  })

  it("formats exactly 1 hour", () => {
    expect(formatAwayDuration(60 * 60_000)).toBe("1h 0m")
  })

  it("formats durations over 1 hour as hours and minutes", () => {
    expect(formatAwayDuration(90 * 60_000)).toBe("1h 30m")
    expect(formatAwayDuration(125 * 60_000)).toBe("2h 5m")
  })

  it("rounds down partial minutes", () => {
    // 3 minutes + 45 seconds = 225000ms → 3m (floor)
    expect(formatAwayDuration(225_000)).toBe("3m")
  })

  it("handles 0ms as 0m", () => {
    expect(formatAwayDuration(0)).toBe("0m")
  })

  it("handles sub-minute duration as 0m", () => {
    expect(formatAwayDuration(30_000)).toBe("0m")
  })
})
