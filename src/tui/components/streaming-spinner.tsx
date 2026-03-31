/**
 * StreamingSpinner — morphing asterisk spinner with playful verbs.
 *
 * Matches native Claude Code's streaming indicator style:
 *   ✱ Shimmying... (5m 49s · ↓ 8.5k tokens)
 *
 * Shown in the conversation area while the agent is working
 * (RUNNING state, before text starts streaming). The label adapts
 * to the current activity: "Thinking..." by default, or
 * "Running [toolName]..." when a tool is executing.
 *
 * During the "Thinking..." phase, the verb cycles every 3 seconds
 * through whimsical synonyms to give visual feedback that the
 * model is actively working.
 */

import { createSignal, onCleanup } from "solid-js"
import { colors } from "../theme/tokens"

// ---------------------------------------------------------------------------
// Morphing asterisk spinner — matches native Claude Code style
// ---------------------------------------------------------------------------

const SPINNER_FRAMES = ['✱', '✳', '✴', '✵']
const SPINNER_INTERVAL_MS = 150

const THINKING_VERBS = [
  // -- From native Claude Code (56 verbs) --
  "Accomplishing", "Actioning", "Actualizing", "Baking", "Brewing",
  "Calculating", "Cerebrating", "Churning", "Clauding", "Coalescing",
  "Cogitating", "Computing", "Conjuring", "Considering", "Cooking",
  "Crafting", "Creating", "Crunching", "Deliberating", "Determining",
  "Doing", "Effecting", "Finagling", "Forging", "Forming",
  "Generating", "Hatching", "Herding", "Honking", "Hustling",
  "Ideating", "Inferring", "Manifesting", "Marinating", "Moseying",
  "Mulling", "Mustering", "Musing", "Noodling", "Percolating",
  "Pondering", "Processing", "Puttering", "Reticulating", "Ruminating",
  "Schlepping", "Shucking", "Simmering", "Smooshing", "Spinning",
  "Stewing", "Synthesizing", "Thinking", "Transmuting", "Vibing",
  "Working",
  // -- Whimsical extras (100 verbs) --
  "Analyzing", "Assembling", "Booping", "Brainstorming", "Bubbling",
  "Calibrating", "Channeling", "Combobulating", "Compiling", "Contemplating",
  "Composing", "Conceiving", "Concocting", "Contriving", "Daydreaming",
  "Deciphering", "Decoding", "Deducing", "Defenestrating", "Devising",
  "Digesting", "Discombobulating", "Distilling", "Dreaming", "Elaborating",
  "Elucidating", "Envisioning", "Evaluating", "Extrapolating", "Fermenting",
  "Figuring", "Flibbertigibbeting", "Formulating", "Fussing", "Gestating",
  "Grooving", "Grokking", "Hypothesizing", "Imagining", "Improvising",
  "Incubating", "Interpolating", "Intuiting", "Inventing", "Iterating",
  "Jigsawing", "Juggling", "Kibbitzing", "Kneading", "Machinating",
  "Meditating", "Metabolizing", "Minding", "Navigating", "Noodging",
  "Orchestrating", "Perambulating", "Philosophizing", "Pickling",
  "Plotting", "Plumbing", "Prognosticating", "Puzzling", "Ratiocinating",
  "Reasoning", "Recombobulating", "Reckoning", "Reflecting", "Scheming",
  "Scoping", "Sculpting", "Shimmying", "Sifting", "Simulating",
  "Sleuthing", "Spit-balling", "Steeping", "Strategizing", "Tinkering",
  "Toiling", "Triangulating", "Unraveling", "Untangling", "Vectoring",
  "Waffling", "Weighing", "Whittling", "Wibbling", "Wrangling",
  "Yearning", "Yodeling", "Zigzagging", "Zooming",
  "Braising", "Cajoling", "Doodling", "Excavating", "Fathoming",
  "Galvanizing", "Harmonizing",
]

export function StreamingSpinner(props: { label: string; elapsedSeconds?: number; outputTokens?: number }) {
  const [frameIndex, setFrameIndex] = createSignal(0)
  const [verbIndex, setVerbIndex] = createSignal(Math.floor(Math.random() * THINKING_VERBS.length))

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

  return (
    <box flexDirection="row">
      <text fg={colors.accent.primary}>{SPINNER_FRAMES[frameIndex()]} </text>
      <text fg={colors.accent.primary}>{displayLabel()}</text>
      <text fg={colors.text.secondary}>{metaStr()}</text>
    </box>
  )
}
