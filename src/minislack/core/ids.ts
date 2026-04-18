/**
 * Slack-style ID minting — deterministic counters per prefix.
 *
 * Prefix conventions:
 *   T – team       U – user         B – bot          A – app
 *   C – public channel   G – private group    D – DM        F – file
 *   M – mpim (we use M for multi-party IM; real Slack uses G too but
 *            minislack keeps them distinct so snapshots round-trip cleanly)
 *
 * Counters live on the Workspace so snapshots are reproducible.
 */

import type { Workspace } from "../types/slack"

export type IdPrefix = "T" | "U" | "B" | "A" | "C" | "G" | "D" | "M" | "F"

/** Mint the next ID for a given prefix. Uses base-10 padded to 8 digits. */
export function nextId(ws: Workspace, prefix: IdPrefix): string {
  const current = ws.idCounters.get(prefix) ?? 0
  const n = current + 1
  ws.idCounters.set(prefix, n)
  return `${prefix}${String(n).padStart(8, "0")}`
}

/** Inspect the last-minted number for a prefix without incrementing. */
export function peekId(ws: Workspace, prefix: IdPrefix): number {
  return ws.idCounters.get(prefix) ?? 0
}
