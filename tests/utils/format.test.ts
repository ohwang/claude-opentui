import { describe, expect, it } from "bun:test"
import {
  formatFileSize,
  formatDuration,
  formatSecondsShort,
  formatNumber,
  formatTokens,
  formatRelativeTime,
  formatRelativeTimeAgo,
} from "../../src/utils/format"

describe("formatFileSize", () => {
  it("formats 0 bytes", () => {
    expect(formatFileSize(0)).toBe("0B")
  })

  it("formats bytes (< 1KB)", () => {
    expect(formatFileSize(500)).toBe("500B")
    expect(formatFileSize(1)).toBe("1B")
  })

  it("formats KB", () => {
    expect(formatFileSize(1024)).toBe("1KB")
    expect(formatFileSize(1536)).toBe("1.5KB")
    expect(formatFileSize(2048)).toBe("2KB")
  })

  it("formats MB", () => {
    expect(formatFileSize(1048576)).toBe("1MB")
    expect(formatFileSize(1572864)).toBe("1.5MB")
  })

  it("formats GB", () => {
    expect(formatFileSize(1073741824)).toBe("1GB")
    expect(formatFileSize(1610612736)).toBe("1.5GB")
  })

  it("removes trailing .0", () => {
    expect(formatFileSize(1024)).toBe("1KB")
    expect(formatFileSize(1048576)).toBe("1MB")
    expect(formatFileSize(1073741824)).toBe("1GB")
  })

  it("handles negative values", () => {
    expect(formatFileSize(-1536)).toBe("-1.5KB")
  })
})

describe("formatDuration", () => {
  it("formats seconds only", () => {
    expect(formatDuration(5000)).toBe("5s")
    expect(formatDuration(0)).toBe("0s")
  })

  it("formats minutes and seconds", () => {
    expect(formatDuration(65000)).toBe("1m 5s")
    expect(formatDuration(120000)).toBe("2m 0s")
  })

  it("formats hours, minutes, and seconds", () => {
    expect(formatDuration(3661000)).toBe("1h 1m 1s")
  })

  it("formats days", () => {
    expect(formatDuration(86400000)).toBe("1d 0h 0m 0s")
    expect(formatDuration(90061000)).toBe("1d 1h 1m 1s")
  })

  it("handles carry-over: 59.5s rounds to 1m 0s", () => {
    expect(formatDuration(59500)).toBe("1m 0s")
  })

  it("handles negative values by clamping to 0", () => {
    expect(formatDuration(-1000)).toBe("0s")
  })

  describe("hideTrailingZeros", () => {
    it("removes trailing zero units", () => {
      expect(formatDuration(60000, { hideTrailingZeros: true })).toBe("1m")
      expect(formatDuration(3600000, { hideTrailingZeros: true })).toBe("1h")
      expect(formatDuration(86400000, { hideTrailingZeros: true })).toBe("1d")
    })

    it("keeps non-trailing zeros", () => {
      expect(formatDuration(3660000, { hideTrailingZeros: true })).toBe("1h 1m")
    })

    it("keeps at least one unit", () => {
      expect(formatDuration(0, { hideTrailingZeros: true })).toBe("0s")
    })
  })

  describe("mostSignificantOnly", () => {
    it("returns only the most significant unit", () => {
      expect(formatDuration(90061000, { mostSignificantOnly: true })).toBe("1d")
      expect(formatDuration(3661000, { mostSignificantOnly: true })).toBe("1h")
      expect(formatDuration(65000, { mostSignificantOnly: true })).toBe("1m")
      expect(formatDuration(5000, { mostSignificantOnly: true })).toBe("5s")
    })

    it("returns 0s for zero duration", () => {
      expect(formatDuration(0, { mostSignificantOnly: true })).toBe("0s")
    })
  })
})

describe("formatSecondsShort", () => {
  it("formats with 1 decimal", () => {
    expect(formatSecondsShort(1234)).toBe("1.2s")
    expect(formatSecondsShort(500)).toBe("0.5s")
    expect(formatSecondsShort(0)).toBe("0.0s")
  })

  it("handles larger values", () => {
    expect(formatSecondsShort(60000)).toBe("60.0s")
    expect(formatSecondsShort(123456)).toBe("123.5s")
  })

  it("handles negative by clamping to 0", () => {
    expect(formatSecondsShort(-500)).toBe("0.0s")
  })
})

describe("formatNumber", () => {
  it("formats numbers below 1000 without fractions", () => {
    expect(formatNumber(900)).toBe("900")
    expect(formatNumber(0)).toBe("0")
    expect(formatNumber(42)).toBe("42")
  })

  it("formats numbers >= 1000 in compact notation", () => {
    expect(formatNumber(1300)).toBe("1.3k")
    expect(formatNumber(1000)).toBe("1.0k")
    expect(formatNumber(10000)).toBe("10.0k")
  })

  it("formats large numbers", () => {
    expect(formatNumber(1500000)).toBe("1.5m")
  })
})

describe("formatTokens", () => {
  it("formats tokens with compact notation", () => {
    expect(formatTokens(1300)).toBe("1.3k")
  })

  it("removes trailing .0", () => {
    expect(formatTokens(2000)).toBe("2k")
    expect(formatTokens(1000)).toBe("1k")
  })

  it("formats small counts without suffix", () => {
    expect(formatTokens(500)).toBe("500")
    expect(formatTokens(0)).toBe("0")
  })
})

describe("formatRelativeTime", () => {
  it("formats past seconds (narrow)", () => {
    const date = new Date(Date.now() - 30000) // 30s ago
    const result = formatRelativeTime(date)
    expect(result).toMatch(/^\d+s ago$/)
  })

  it("formats past minutes (narrow)", () => {
    const date = new Date(Date.now() - 300000) // 5m ago
    const result = formatRelativeTime(date)
    expect(result).toMatch(/^\d+m ago$/)
  })

  it("formats past hours (narrow)", () => {
    const date = new Date(Date.now() - 7200000) // 2h ago
    const result = formatRelativeTime(date)
    expect(result).toMatch(/^\d+h ago$/)
  })

  it("formats past days (narrow)", () => {
    const date = new Date(Date.now() - 172800000) // 2d ago
    const result = formatRelativeTime(date)
    expect(result).toMatch(/^\d+d ago$/)
  })

  it("formats future times with 'in' prefix (narrow)", () => {
    const date = new Date(Date.now() + 300000) // 5m from now
    const result = formatRelativeTime(date)
    expect(result).toMatch(/^in \d+m$/)
  })

  it("formats with long style using Intl", () => {
    const date = new Date(Date.now() - 7200000) // 2h ago
    const result = formatRelativeTime(date, { style: "long" })
    expect(result).toContain("hour")
    expect(result).toContain("ago")
  })

  it("formats with short style using Intl", () => {
    const date = new Date(Date.now() - 300000) // 5m ago
    const result = formatRelativeTime(date, { style: "short" })
    expect(result).toContain("ago")
  })
})

describe("formatRelativeTimeAgo", () => {
  it("formats past dates the same as formatRelativeTime", () => {
    const date = new Date(Date.now() - 60000) // 1m ago
    const result = formatRelativeTimeAgo(date)
    expect(result).toMatch(/^\d+m? ago$|^\d+s ago$/)
  })

  it("clamps future dates to now (0s ago)", () => {
    const date = new Date(Date.now() + 60000) // 1m in future
    const result = formatRelativeTimeAgo(date)
    expect(result).toBe("0s ago")
  })
})
