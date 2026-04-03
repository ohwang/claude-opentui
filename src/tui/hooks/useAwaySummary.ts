/**
 * Away Summary Hook
 *
 * Detects when the user returns after being away from the terminal
 * and shows a local recap of activity that occurred while away.
 *
 * Uses DECSET 1004 focus reporting to detect terminal blur/focus.
 * If the terminal doesn't support focus events, nothing fires
 * (graceful degradation).
 */

import { onCleanup } from "solid-js"
import {
  onFocusChange,
  enableFocusReporting,
} from "../../utils/terminal-focus"

const AWAY_THRESHOLD_MS = 3 * 60 * 1000 // 3 minutes

export interface AwaySummaryOptions {
  /** Return activity stats since the last user message. */
  getBlocksSinceLastActivity: () => {
    toolCount: number
    assistantCount: number
  }
  /** Called with the formatted summary string to display. */
  onShowSummary: (summary: string) => void
}

export function useAwaySummary(opts: AwaySummaryOptions): void {
  let blurTime: number | null = null

  enableFocusReporting()

  const cleanup = onFocusChange((focused) => {
    if (!focused) {
      blurTime = Date.now()
    } else if (blurTime) {
      const awayDuration = Date.now() - blurTime
      if (awayDuration >= AWAY_THRESHOLD_MS) {
        // Generate local recap
        const stats = opts.getBlocksSinceLastActivity()
        if (stats.toolCount > 0 || stats.assistantCount > 0) {
          const parts: string[] = []
          if (stats.assistantCount > 0)
            parts.push(
              `${stats.assistantCount} response${stats.assistantCount > 1 ? "s" : ""}`,
            )
          if (stats.toolCount > 0)
            parts.push(
              `${stats.toolCount} tool use${stats.toolCount > 1 ? "s" : ""}`,
            )
          const duration = formatAwayDuration(awayDuration)
          const summary = `Welcome back! While you were away (${duration}): ${parts.join(", ")}`
          opts.onShowSummary(summary)
        }
      }
      blurTime = null
    }
  })

  onCleanup(cleanup)
}

/** Format a millisecond duration as a short human-readable string. */
export function formatAwayDuration(ms: number): string {
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  return `${hours}h ${mins % 60}m`
}
