/**
 * CompactBlock — visual marker for context compaction.
 *
 * Handles the full compact lifecycle:
 *   1. In-progress: animated spinner with "Compacting..." label
 *   2. Completed: summary text, token savings, and clear visual boundary
 *
 * Distinguishes between user-initiated (/compact) and auto-compaction
 * (backend-initiated) with appropriate labeling.
 *
 * Inspired by Claude Code's CompactSummary component with a dashed
 * separator line, muted summary text, and token savings display.
 */

import { Show, createSignal } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { useAnimationFrame } from "../../context/animation"
import { colors } from "../../theme/tokens"
import { formatTokens } from "../../../utils/format"
import type { Block } from "../../../protocol/types"

type CompactBlockType = Extract<Block, { type: "compact" }>

// Braille spinner frames (same pattern as StreamingSpinner)
const SPINNER_FRAMES = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"]
const SPINNER_INTERVAL_MS = 80

export function CompactBlock(props: { block?: CompactBlockType }) {
  const dims = useTerminalDimensions()
  const summary = () => props.block?.summary ?? ""
  const isInProgress = () => !!props.block?.inProgress
  const trigger = () => props.block?.trigger
  const preTokens = () => props.block?.preTokens
  const postTokens = () => props.block?.postTokens

  // Spinner animation for in-progress state
  const [frameIndex, setFrameIndex] = createSignal(0)
  let spinnerAccum = 0

  useAnimationFrame((dt) => {
    if (!isInProgress()) return
    spinnerAccum += dt
    if (spinnerAccum >= SPINNER_INTERVAL_MS) {
      const steps = Math.floor(spinnerAccum / SPINNER_INTERVAL_MS)
      spinnerAccum -= steps * SPINNER_INTERVAL_MS
      setFrameIndex((i) => (i + steps) % SPINNER_FRAMES.length)
    }
  })

  // Build the dashed separator line
  const separator = () => {
    const width = (dims()?.width ?? 80) - 4 // account for padding
    return "\u2500".repeat(Math.max(width, 20))
  }

  // Token savings display
  const tokenSavings = () => {
    const pre = preTokens()
    const post = postTokens()
    if (pre != null && post != null && pre > post) {
      const saved = pre - post
      return `Reclaimed ${formatTokens(saved)} tokens (${formatTokens(pre)} \u2192 ${formatTokens(post)})`
    }
    if (pre != null) {
      return `${formatTokens(pre)} tokens before compaction`
    }
    return null
  }

  // Label for the compact boundary
  const label = () => {
    if (isInProgress()) return "Compacting conversation"
    if (trigger() === "auto") return "Auto-compacted"
    return "Conversation compacted"
  }

  return (
    <box flexDirection="column" paddingLeft={2}>
      {/* Separator line */}
      <text fg={colors.text.inactive}>{separator()}</text>

      <Show
        when={!isInProgress()}
        fallback={
          /* In-progress: spinner + label */
          <box flexDirection="row" paddingLeft={0} marginTop={0}>
            <text fg={colors.accent.primary}>
              {SPINNER_FRAMES[frameIndex()] + " "}
            </text>
            <text fg={colors.accent.primary}>
              {label() + "..."}
            </text>
          </box>
        }
      >
        {/* Completed: label */}
        <box paddingLeft={0} marginTop={0}>
          <text fg={colors.text.secondary} attributes={TextAttributes.BOLD}>
            {"\u2713 " + label()}
          </text>
        </box>

        {/* Summary text */}
        <Show when={summary() && summary() !== "Compacting conversation..."}>
          <box paddingLeft={2} marginTop={0}>
            <text fg={colors.text.secondary}>
              {summary()}
            </text>
          </box>
        </Show>

        {/* Token savings */}
        <Show when={tokenSavings()}>
          <box paddingLeft={2} marginTop={0}>
            <text fg={colors.text.muted}>
              {tokenSavings()}
            </text>
          </box>
        </Show>
      </Show>

      {/* Bottom separator */}
      <text fg={colors.text.inactive}>{separator()}</text>
    </box>
  )
}
