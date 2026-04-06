/**
 * ShortcutHint -- renders a single keyboard shortcut hint like "Enter to select"
 * or "(Esc to cancel)" when parens is true.
 *
 * Uses dim muted styling consistent with the rest of the TUI hint system.
 */

import { TextAttributes } from "@opentui/core"
import { colors } from "../../theme/tokens"

export interface ShortcutHintProps {
  /** The key combination, e.g. "Enter", "Esc", "Ctrl+R" */
  shortcut: string
  /** What the shortcut does, e.g. "select", "cancel", "search" */
  action: string
  /** Wrap in parentheses: "(Esc to cancel)" */
  parens?: boolean
}

export function ShortcutHint(props: ShortcutHintProps) {
  const text = () => {
    const inner = `${props.shortcut} to ${props.action}`
    return props.parens ? `(${inner})` : inner
  }

  return (
    <text fg={colors.text.inactive} attributes={TextAttributes.DIM}>
      {text()}
    </text>
  )
}
