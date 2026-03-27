/**
 * Thinking Block — Collapsible thinking content
 *
 * Shows Claude's reasoning process. Collapsed by default,
 * expands on Ctrl+O with the rest of the tool view.
 */

import { createSignal, Show } from "solid-js"

export function ThinkingBlock(props: { text: string; collapsed?: boolean }) {
  const [expanded, setExpanded] = createSignal(!props.collapsed)

  const preview = () => {
    const lines = props.text.split("\n")
    if (lines.length <= 1 && props.text.length <= 80) return props.text
    return props.text.slice(0, 77) + "..."
  }

  return (
    <box flexDirection="column">
      <Show
        when={expanded()}
        fallback={
          <text color="gray" dimmed>
            {"💭 "}{preview()}
          </text>
        }
      >
        <box flexDirection="column" paddingLeft={2}>
          <text color="gray" dimmed bold>
            {"💭 Thinking"}
          </text>
          <text color="gray" dimmed>
            {props.text}
          </text>
        </box>
      </Show>
    </box>
  )
}
