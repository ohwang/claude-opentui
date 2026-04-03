/**
 * Format utilities — ported from Claude Code's format helpers.
 *
 * Provides human-readable formatting for file sizes, durations, numbers,
 * tokens, and relative timestamps used throughout the TUI.
 */

// ---------------------------------------------------------------------------
// Cached Intl formatters (expensive to create)
// ---------------------------------------------------------------------------

let _compactFmt: Intl.NumberFormat | undefined
function compactNumberFormat(): Intl.NumberFormat {
  if (!_compactFmt) {
    _compactFmt = new Intl.NumberFormat("en-US", {
      notation: "compact",
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })
  }
  return _compactFmt
}

let _plainFmt: Intl.NumberFormat | undefined
function plainNumberFormat(): Intl.NumberFormat {
  if (!_plainFmt) {
    _plainFmt = new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 0,
    })
  }
  return _plainFmt
}

const relativeTimeFormatCache = new Map<string, Intl.RelativeTimeFormat>()
function getRelativeTimeFormat(style: "narrow" | "short" | "long"): Intl.RelativeTimeFormat {
  let fmt = relativeTimeFormatCache.get(style)
  if (!fmt) {
    fmt = new Intl.RelativeTimeFormat("en", { style, numeric: "always" })
    relativeTimeFormatCache.set(style, fmt)
  }
  return fmt
}

// ---------------------------------------------------------------------------
// formatFileSize
// ---------------------------------------------------------------------------

/**
 * Converts bytes to a human-readable size string (KB/MB/GB) with 1 decimal.
 * Trailing ".0" is removed (e.g., 1536 -> "1.5KB", 1024 -> "1KB").
 */
export function formatFileSize(sizeInBytes: number): string {
  if (sizeInBytes === 0) return "0B"

  const abs = Math.abs(sizeInBytes)
  const sign = sizeInBytes < 0 ? "-" : ""

  if (abs < 1024) return `${sign}${abs}B`
  if (abs < 1024 * 1024) {
    const val = (abs / 1024).toFixed(1)
    return `${sign}${stripTrailingZeroDecimal(val)}KB`
  }
  if (abs < 1024 * 1024 * 1024) {
    const val = (abs / (1024 * 1024)).toFixed(1)
    return `${sign}${stripTrailingZeroDecimal(val)}MB`
  }
  const val = (abs / (1024 * 1024 * 1024)).toFixed(1)
  return `${sign}${stripTrailingZeroDecimal(val)}GB`
}

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

export interface FormatDurationOptions {
  /** Hide trailing zero units (e.g., "1m" instead of "1m 0s") */
  hideTrailingZeros?: boolean
  /** Only show the most significant non-zero unit */
  mostSignificantOnly?: boolean
}

/**
 * Formats a duration in milliseconds to a multi-unit string (days/hours/minutes/seconds).
 * Handles carry-over: 59.5s rounds to 60s which becomes 1m 0s.
 */
export function formatDuration(ms: number, options?: FormatDurationOptions): string {
  if (ms < 0) ms = 0

  // Round to nearest second, handling carry-over (59.5s -> 60s -> 1m 0s)
  let totalSeconds = Math.round(ms / 1000)

  const days = Math.floor(totalSeconds / 86400)
  totalSeconds %= 86400
  const hours = Math.floor(totalSeconds / 3600)
  totalSeconds %= 3600
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  // Include all units from the most significant non-zero unit downward.
  // e.g., 1d 0h 0m 0s — once days are present, hours/minutes/seconds all show.
  const parts: string[] = []
  let started = false
  if (days > 0)    { started = true; parts.push(`${days}d`) }
  if (hours > 0 || started) { started = true; parts.push(`${hours}h`) }
  if (minutes > 0 || started) { started = true; parts.push(`${minutes}m`) }
  parts.push(`${seconds}s`)

  if (options?.mostSignificantOnly) {
    // Return just the first (most significant) non-zero unit
    // If everything is 0, return "0s"
    for (const part of parts) {
      if (!part.startsWith("0") || part === "0s") return part
    }
    return "0s"
  }

  if (options?.hideTrailingZeros) {
    // Remove trailing "0s", "0m", etc. but keep at least one unit
    while (parts.length > 1 && parts[parts.length - 1]!.startsWith("0")) {
      parts.pop()
    }
  }

  return parts.join(" ")
}

// ---------------------------------------------------------------------------
// formatSecondsShort
// ---------------------------------------------------------------------------

/**
 * Formats milliseconds as seconds with 1 decimal (e.g., 1234 -> "1.2s").
 * Always shows 1 decimal digit for sub-minute precision display.
 */
export function formatSecondsShort(ms: number): string {
  if (ms < 0) ms = 0
  return `${(ms / 1000).toFixed(1)}s`
}

// ---------------------------------------------------------------------------
// formatNumber
// ---------------------------------------------------------------------------

/**
 * Formats a number in compact notation (e.g., 1300 -> "1.3k", 900 -> "900").
 * Uses cached Intl.NumberFormat for performance.
 */
export function formatNumber(n: number): string {
  if (Math.abs(n) < 1000) {
    return plainNumberFormat().format(n)
  }
  return compactNumberFormat().format(n).toLowerCase()
}

// ---------------------------------------------------------------------------
// formatTokens
// ---------------------------------------------------------------------------

/**
 * Like formatNumber but removes trailing ".0" suffix
 * (e.g., 2000 -> "2k" not "2.0k").
 */
export function formatTokens(count: number): string {
  return stripTrailingZeroDecimal(formatNumber(count))
}

// ---------------------------------------------------------------------------
// formatRelativeTime
// ---------------------------------------------------------------------------

export interface FormatRelativeTimeOptions {
  /** Display style: "narrow" ("5m"), "short" ("5 min."), "long" ("5 minutes ago") */
  style?: "narrow" | "short" | "long"
}

/**
 * Formats a date as a relative time string ("5m ago", "in 2h").
 * Uses Intl.RelativeTimeFormat for "long" style, custom narrow formatting otherwise.
 */
export function formatRelativeTime(date: Date, options?: FormatRelativeTimeOptions): string {
  const style = options?.style ?? "narrow"
  const diffMs = Date.now() - date.getTime()
  const absDiffMs = Math.abs(diffMs)
  const isPast = diffMs >= 0

  const { value, unit } = selectTimeUnit(absDiffMs)

  if (style === "long" || style === "short") {
    const fmt = getRelativeTimeFormat(style)
    return fmt.format(isPast ? -value : value, unit)
  }

  // Narrow style: custom compact format
  const unitChar = narrowUnitChar(unit)
  const formatted = `${value}${unitChar}`
  return isPast ? `${formatted} ago` : `in ${formatted}`
}

// ---------------------------------------------------------------------------
// formatRelativeTimeAgo
// ---------------------------------------------------------------------------

/**
 * Wrapper around formatRelativeTime that ensures past dates always show "ago".
 * Future dates are clamped to "0s ago" (or equivalent).
 */
export function formatRelativeTimeAgo(date: Date, options?: FormatRelativeTimeOptions): string {
  const now = Date.now()
  const clamped = date.getTime() > now ? new Date(now) : date
  return formatRelativeTime(clamped, options)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Remove ".0" from a formatted number string */
function stripTrailingZeroDecimal(str: string): string {
  return str.replace(/\.0(?=[a-zA-Z]|$)/, "")
}

/** Select the most appropriate time unit for a duration */
function selectTimeUnit(absMs: number): { value: number; unit: Intl.RelativeTimeFormatUnit } {
  const absSecs = Math.floor(absMs / 1000)

  if (absSecs < 60) return { value: absSecs, unit: "second" }
  if (absSecs < 3600) return { value: Math.floor(absSecs / 60), unit: "minute" }
  if (absSecs < 86400) return { value: Math.floor(absSecs / 3600), unit: "hour" }
  return { value: Math.floor(absSecs / 86400), unit: "day" }
}

/** Map Intl.RelativeTimeFormat unit names to single-char abbreviations for narrow display */
function narrowUnitChar(unit: Intl.RelativeTimeFormatUnit): string {
  switch (unit) {
    case "second": return "s"
    case "minute": return "m"
    case "hour": return "h"
    case "day": return "d"
    default: return ""
  }
}
