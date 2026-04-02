/**
 * StreamingSpinner — morphing asterisk spinner with rotating verbs.
 *
 * Matches native Claude Code's streaming indicator style:
 *   ✱ Thinking... (5m 49s · ↓ 8.5k tokens)
 *
 * Shown in the conversation area while the agent is working
 * (RUNNING state, before text starts streaming). The label adapts
 * to the current activity: "Thinking..." by default, or
 * "Running [toolName]..." when a tool is executing.
 *
 * During the "Thinking..." phase, the verb cycles every 3 seconds
 * through tasteful synonyms to give visual feedback that the
 * model is actively working.
 */

import { createSignal, createEffect, onCleanup } from "solid-js"
import { colors } from "../theme/tokens"

// ---------------------------------------------------------------------------
// Morphing asterisk spinner — matches native Claude Code style
// ---------------------------------------------------------------------------

const SPINNER_FRAMES = ['✱', '✳', '✴', '✵']
const SPINNER_INTERVAL_MS = 150

const THINKING_VERBS = [
  "Thinking", "Reasoning", "Analyzing", "Considering", "Processing",
  "Evaluating", "Reflecting", "Synthesizing", "Formulating", "Exploring",
]

// Stall detection thresholds (seconds without token count change)
const STALL_WARNING_SECS = 30
const STALL_ERROR_SECS = 60

export function StreamingSpinner(props: { label: string; elapsedSeconds?: number; outputTokens?: number }) {
  const [frameIndex, setFrameIndex] = createSignal(0)
  const [verbIndex, setVerbIndex] = createSignal(Math.floor(Math.random() * THINKING_VERBS.length))

  // -- Stall detection: track when outputTokens last changed ----------------
  let lastTokenCount = props.outputTokens ?? 0
  let lastTokenChangeTime = Date.now()
  const [stallDurationSecs, setStallDurationSecs] = createSignal(0)

  createEffect(() => {
    const current = props.outputTokens ?? 0
    if (current !== lastTokenCount) {
      lastTokenCount = current
      lastTokenChangeTime = Date.now()
      setStallDurationSecs(0)
    }
  })

  // Poll stall duration every second (aligned with the elapsed timer cadence)
  const stallTimer = setInterval(() => {
    const elapsed = (Date.now() - lastTokenChangeTime) / 1000
    setStallDurationSecs(Math.floor(elapsed))
  }, 1000)

  const timer = setInterval(() => {
    setFrameIndex((i) => (i + 1) % SPINNER_FRAMES.length)
  }, SPINNER_INTERVAL_MS)

  // Cycle thinking verbs every 3 seconds (only when label is "Thinking...")
  // Random selection avoids the predictable sequential feel; re-roll to
  // prevent showing the same verb twice in a row.
  const verbTimer = setInterval(() => {
    if (props.label === "Thinking...") {
      setVerbIndex((prev) => {
        let next = Math.floor(Math.random() * THINKING_VERBS.length)
        while (next === prev) {
          next = Math.floor(Math.random() * THINKING_VERBS.length)
        }
        return next
      })
    }
  }, 3000)

  onCleanup(() => {
    clearInterval(timer)
    clearInterval(verbTimer)
    clearInterval(stallTimer)
  })

  const displayLabel = () => {
    if (props.label === "Thinking...") {
      return THINKING_VERBS[verbIndex()] + "..."
    }
    return props.label
  }

  const timeStr = () => {
    const secs = props.elapsedSeconds ?? 0
    if (secs === 0) return ""
    if (secs < 60) return `${secs}s`
    const mins = Math.floor(secs / 60)
    const remSecs = secs % 60
    return `${mins}m ${remSecs}s`
  }

  const tokenStr = () => {
    const tokens = props.outputTokens ?? 0
    if (tokens === 0) return ""
    if (tokens >= 1000) return `\u2193 ${(tokens / 1000).toFixed(1)}k tokens`
    return `\u2193 ${tokens} tokens`
  }

  const metaStr = () => {
    const parts = [timeStr(), tokenStr()].filter(Boolean)
    return parts.length > 0 ? ` (${parts.join(" \u00B7 ")})` : ""
  }

  // -- Stall-aware color: normal -> amber (30s) -> red (60s) ----------------
  const spinnerColor = () => {
    const secs = stallDurationSecs()
    if (secs >= STALL_ERROR_SECS) return colors.status.error
    if (secs >= STALL_WARNING_SECS) return colors.status.warning
    return colors.accent.primary
  }

  const stallSuffix = () => {
    return stallDurationSecs() >= STALL_ERROR_SECS ? " (may be stalled)" : ""
  }

  return (
    <box flexDirection="row">
      <text fg={spinnerColor()}>{SPINNER_FRAMES[frameIndex()]} </text>
      <text fg={spinnerColor()}>{displayLabel()}</text>
      <text fg={colors.text.secondary}>{metaStr()}</text>
      <text fg={colors.status.error}>{stallSuffix()}</text>
    </box>
  )
}
