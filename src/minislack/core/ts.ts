/**
 * Slack-style "<unixSec>.<seq6>" timestamp generator.
 *
 * Two guarantees that the rest of minislack relies on:
 *   1. Strict monotonicity per channel. If two messages are posted in the
 *      same millisecond, the second gets a strictly greater ts.
 *   2. Lexicographic sort == chronological sort. Zero-padded 6-digit
 *      sequence keeps this true within the same second.
 */

import type { Workspace } from "../types/slack"

/** Mint the next ts for a given channel. Clock source is injectable for tests. */
export function nextTs(
  ws: Workspace,
  channelId: string,
  now: () => number = Date.now,
): string {
  const unixSec = Math.floor(now() / 1000)
  const state = ws.tsState.get(channelId)

  let seq: number
  let effectiveUnix: number

  if (!state) {
    effectiveUnix = unixSec
    seq = 1
  } else if (unixSec > state.lastUnix) {
    effectiveUnix = unixSec
    seq = 1
  } else {
    // Clock did not advance — bump seq, keep the previous unix.
    effectiveUnix = state.lastUnix
    seq = state.seq + 1
  }

  ws.tsState.set(channelId, { lastUnix: effectiveUnix, seq })
  return `${effectiveUnix}.${String(seq).padStart(6, "0")}`
}

/** Compare two Slack ts values. Returns <0 / 0 / >0. */
export function compareTs(a: string, b: string): number {
  // Lexicographic compare works because both halves are zero-padded.
  return a < b ? -1 : a > b ? 1 : 0
}

/** Parse a ts into numeric parts. Returns null on malformed input. */
export function parseTs(ts: string): { unixSec: number; seq: number } | null {
  const dot = ts.indexOf(".")
  if (dot < 0) return null
  const unix = Number(ts.slice(0, dot))
  const seq = Number(ts.slice(dot + 1))
  if (!Number.isFinite(unix) || !Number.isFinite(seq)) return null
  return { unixSec: unix, seq }
}
