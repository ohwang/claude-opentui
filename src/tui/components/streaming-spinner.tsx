/**
 * StreamingSpinner — Braille dot spinner with smooth RGB stall color.
 *
 * Matches Claude Code's streaming indicator style:
 *   ⠋ Thinking... (5m 49s · ↓ 8.5k tokens)
 *
 * Shown in the conversation area while the agent is working
 * (RUNNING state, before text starts streaming). The label adapts
 * to the current activity: "Thinking..." by default, or
 * "Running [toolName]..." when a tool is executing.
 *
 * During the "Thinking..." phase, the verb cycles every 3 seconds
 * through tasteful synonyms to give visual feedback that the
 * model is actively working.
 *
 * Stall detection: if no new tokens arrive for 3 seconds (and no
 * tools are actively running), the spinner color smoothly
 * interpolates from accent to red over 2 seconds.
 *
 * Uses the centralized AnimationContext clock instead of per-component
 * setInterval timers.
 */

import { createSignal, createEffect } from "solid-js"
import { useAnimationFrame } from "../context/animation"
import { colors } from "../theme/tokens"

// ---------------------------------------------------------------------------
// Braille dot spinner — forward + reverse cycle
// ---------------------------------------------------------------------------

const DEFAULT_CHARS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPINNER_FRAMES = [...DEFAULT_CHARS, ...[...DEFAULT_CHARS].reverse()]
const SPINNER_INTERVAL_MS = 80

const THINKING_VERBS = [
  "Thinking", "Reasoning", "Analyzing", "Considering", "Processing",
  "Evaluating", "Reflecting", "Synthesizing", "Formulating", "Exploring",
]

// ---------------------------------------------------------------------------
// Stall detection — smooth RGB interpolation
// ---------------------------------------------------------------------------

const STALL_START_MS = 3000   // Start showing red after 3s of no tokens
const STALL_FULL_MS = 5000    // Fully red after 5s (3s + 2s fade)
const ERROR_RED: RGB = { r: 171, g: 43, b: 63 }  // Claude Code's stall red

interface RGB { r: number; g: number; b: number }

function parseHexColor(hex: string): RGB {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

function interpolateColor(from: RGB, to: RGB, t: number): string {
  const r = Math.round(from.r + (to.r - from.r) * t)
  const g = Math.round(from.g + (to.g - from.g) * t)
  const b = Math.round(from.b + (to.b - from.b) * t)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

// Pre-parse the accent color once at module load
const ACCENT_RGB = parseHexColor(colors.accent.primary)

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// Verb cycle interval (ms)
const VERB_CYCLE_MS = 3000

export function StreamingSpinner(props: { label: string; elapsedSeconds?: number; outputTokens?: number }) {
  const [frameIndex, setFrameIndex] = createSignal(0)
  const [verbIndex, setVerbIndex] = createSignal(Math.floor(Math.random() * THINKING_VERBS.length))

  // -- Stall detection: track when outputTokens last changed ----------------
  let lastTokenCount = props.outputTokens ?? 0
  let lastTokenChangeTime = Date.now()

  // Signal that drives re-render of the color at ~80ms (piggybacks on the
  // spinner frame timer so we get smooth color updates without extra timers).
  const [stallIntensity, setStallIntensity] = createSignal(0)

  createEffect(() => {
    const current = props.outputTokens ?? 0
    if (current !== lastTokenCount) {
      lastTokenCount = current
      lastTokenChangeTime = Date.now()
      setStallIntensity(0)
    }
  })

  // Detect whether tools are actively running from the label.
  // When a tool is running, the label is "Running <toolName>..." — don't
  // count stall time in that case.
  const isToolRunning = () => props.label !== "Thinking..." && props.label.startsWith("Running ")

  // -- Accumulated time trackers for animation frame approach ----------------
  let spinnerAccum = 0
  let verbAccum = 0

  useAnimationFrame((dt) => {
    // Spinner frame advance (~80ms)
    spinnerAccum += dt
    if (spinnerAccum >= SPINNER_INTERVAL_MS) {
      const steps = Math.floor(spinnerAccum / SPINNER_INTERVAL_MS)
      spinnerAccum -= steps * SPINNER_INTERVAL_MS
      setFrameIndex((i) => (i + steps) % SPINNER_FRAMES.length)
    }

    // Update stall intensity on every frame tick for smooth color transition
    if (isToolRunning()) {
      // Reset stall tracking when tools are active
      lastTokenChangeTime = Date.now()
      setStallIntensity(0)
    } else {
      const timeSinceToken = Date.now() - lastTokenChangeTime
      if (timeSinceToken < STALL_START_MS) {
        setStallIntensity(0)
      } else {
        setStallIntensity(Math.min((timeSinceToken - STALL_START_MS) / (STALL_FULL_MS - STALL_START_MS), 1))
      }
    }

    // Verb cycling (~3s, only during "Thinking...")
    // Random selection avoids the predictable sequential feel; re-roll to
    // prevent showing the same verb twice in a row.
    verbAccum += dt
    if (verbAccum >= VERB_CYCLE_MS) {
      verbAccum -= VERB_CYCLE_MS
      if (props.label === "Thinking...") {
        setVerbIndex((prev) => {
          let next = Math.floor(Math.random() * THINKING_VERBS.length)
          while (next === prev) {
            next = Math.floor(Math.random() * THINKING_VERBS.length)
          }
          return next
        })
      }
    }
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

  // -- Smooth RGB color: accent -> red based on stall intensity -------------
  const spinnerColor = () => {
    const intensity = stallIntensity()
    if (intensity <= 0) return colors.accent.primary
    return interpolateColor(ACCENT_RGB, ERROR_RED, intensity)
  }

  const stallSuffix = () => {
    return stallIntensity() >= 1 ? " (may be stalled)" : ""
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
