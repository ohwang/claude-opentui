/**
 * Thinking Block — Collapsible thinking content
 *
 * Shows Claude's reasoning process. Collapsed by default,
 * expands on Ctrl+O with the rest of the tool view.
 */

import { Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { colors } from "../theme/tokens"

export function ThinkingBlock(props: { text: string; collapsed?: boolean }) {
  const expanded = () => !props.collapsed
  const text = () => props.text ?? ""

  const preview = () => {
    const t = text()
    const lines = t.split("\n")
    if (lines.length <= 1 && t.length <= 80) return t
    return t.slice(0, 77) + "..."
  }

  return (
    <box flexDirection="column" paddingLeft={2}>
      <Show
        when={expanded()}
        fallback={
          <box flexDirection="row">
            <text fg={colors.text.muted} attributes={TextAttributes.DIM | TextAttributes.BOLD}>
              {"\u25B8 Thinking"}
            </text>
            <text fg={colors.text.muted} attributes={TextAttributes.DIM}>
              {"  " + preview()}
            </text>
          </box>
        }
      >
        <text fg={colors.text.muted} attributes={TextAttributes.DIM | TextAttributes.BOLD}>
          {"\u25BE Thinking"}
        </text>
        <box paddingLeft={2}>
          <text fg={colors.text.muted} attributes={TextAttributes.DIM}>
            {text()}
          </text>
        </box>
      </Show>
    </box>
  )
}
