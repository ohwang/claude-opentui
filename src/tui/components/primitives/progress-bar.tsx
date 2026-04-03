/**
 * ProgressBar — sub-character-resolution progress bar.
 *
 * Uses Unicode block elements (▏▎▍▌▋▊▉█) for smooth fill.
 * Inspired by Claude Code's design-system/ProgressBar.
 *
 * @example
 * <ProgressBar ratio={0.65} width={10} fillColor={colors.status.success} />
 * // Renders: "██████▌   " (smooth sub-character fill)
 */

import { colors } from "../../theme/tokens"

// Sub-character block elements from empty to full
const BLOCKS = [" ", "\u258F", "\u258E", "\u258D", "\u258C", "\u258B", "\u258A", "\u2589", "\u2588"]

export function ProgressBar(props: {
  /** Progress ratio, 0 to 1 */
  ratio: number
  /** Width in characters */
  width?: number
  /** Color for the filled portion */
  fillColor?: string
  /** Color for the empty portion */
  emptyColor?: string
}) {
  const width = () => props.width ?? 10
  const fillColor = () => props.fillColor ?? colors.status.success
  const emptyColor = () => props.emptyColor ?? colors.text.muted

  const bar = () => {
    const ratio = Math.min(1, Math.max(0, props.ratio))
    const w = width()
    const whole = Math.floor(ratio * w)
    const filled = BLOCKS[BLOCKS.length - 1]!.repeat(whole)

    if (whole >= w) {
      return { filled, partial: "", empty: "" }
    }

    const remainder = ratio * w - whole
    const partialIdx = Math.floor(remainder * BLOCKS.length)
    const partial = BLOCKS[partialIdx] ?? " "
    const emptyCount = w - whole - 1
    const empty = emptyCount > 0 ? BLOCKS[0]!.repeat(emptyCount) : ""

    return { filled, partial, empty }
  }

  return (
    <box flexDirection="row">
      <text fg={fillColor()}>{bar().filled}</text>
      <text fg={fillColor()}>{bar().partial}</text>
      <text fg={emptyColor()}>{bar().empty}</text>
    </box>
  )
}
