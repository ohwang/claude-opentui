/**
 * Thinking Block — Collapsible thinking content
 *
 * Shows Claude's reasoning process. Collapsed by default,
 * expands on Ctrl+O with the rest of the tool view.
 */

import { Show } from "solid-js"
import { TextAttributes } from "@opentui/core"

export function ThinkingBlock(props: { text: string; collapsed?: boolean }) {
  const expanded = () => !props.collapsed

  const preview = () => {
    const lines = props.text.split("\n")
    if (lines.length <= 1 && props.text.length <= 80) return props.text
    return props.text.slice(0, 77) + "..."
  }

  return (
    <box flexDirection="column" paddingLeft={2}>
      <Show
        when={expanded()}
        fallback={
          <box flexDirection="row">
            <text fg="gray" attributes={TextAttributes.DIM | TextAttributes.BOLD}>
              {"\u25B8 Thinking"}
            </text>
            <text fg="gray" attributes={TextAttributes.DIM}>
              {"  " + preview()}
            </text>
          </box>
        }
      >
        <text fg="gray" attributes={TextAttributes.DIM | TextAttributes.BOLD}>
          {"\u25BE Thinking"}
        </text>
        <box paddingLeft={2}>
          <text fg="gray" attributes={TextAttributes.DIM}>
            {props.text}
          </text>
        </box>
      </Show>
    </box>
  )
}
