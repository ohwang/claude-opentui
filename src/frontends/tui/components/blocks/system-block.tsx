/**
 * SystemBlock — categorized system message with icon and color.
 *
 * System messages are visually categorized by content keywords:
 * interrupt, denial, error, success, or info.
 */

import { TextAttributes } from "@opentui/core"
import { colors } from "../../theme/tokens"
import type { Block } from "../../../../protocol/types"

type SystemBlockType = Extract<Block, { type: "system" }>

// ---------------------------------------------------------------------------
// System message visual categorization
// ---------------------------------------------------------------------------

export type SystemCategory = "interrupt" | "denial" | "error" | "success" | "info"

export function categorizeSystemMessage(text: string): SystemCategory {
  const lower = text.toLowerCase()
  if (lower.includes("interrupted") || lower.includes("interrupt")) return "interrupt"
  if (lower.includes("denied")) return "denial"
  if (lower.includes("failed") || lower.includes("error") || lower.includes("cannot")) return "error"
  if (lower.includes("copied") || lower.includes("switched") || lower.includes("cleared") || lower.includes("connected")) return "success"
  return "info"
}

function systemMessageStyle(text: string): { icon: string; color: string; attrs: number } {
  switch (categorizeSystemMessage(text)) {
    case "interrupt": return { icon: "\u23BF", color: colors.status.warning, attrs: TextAttributes.BOLD }
    case "denial":    return { icon: "\u2717", color: colors.status.warning, attrs: TextAttributes.DIM }
    case "error":     return { icon: "\u2717", color: colors.status.error,   attrs: 0 }
    case "success":   return { icon: "\u2713", color: colors.status.success, attrs: TextAttributes.DIM }
    default:          return { icon: "\u00B7", color: colors.text.muted,     attrs: 0 }
  }
}

export function SystemBlock(props: { block: SystemBlockType }) {
  const style = () => systemMessageStyle(props.block.text)
  return (
    <box paddingLeft={2}>
      <text fg={style().color} attributes={style().attrs}>
        {style().icon + " " + props.block.text}
      </text>
    </box>
  )
}
