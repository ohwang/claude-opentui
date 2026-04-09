/**
 * Thinking Block — Collapsible thinking content with blockquote style
 *
 * Shows Claude's reasoning process in a markdown-blockquote visual:
 * a left border bar (│) with content indented beside it.
 *
 * Collapsed: "💡 Thinking (ctrl+o to expand)"
 * Expanded:
 *   💡 Thinking…
 *   │ <markdown content>
 */

import { Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { colors } from "../theme/tokens"
import { syntaxStyle } from "../theme"

export function ThinkingBlock(props: { text: string; collapsed?: boolean }) {
  const MAX_LINES = 10
  const expanded = () => !props.collapsed
  const text = () => props.text ?? ""
  const truncatedText = () => {
    const lines = text().split("\n")
    if (lines.length <= MAX_LINES) return text()
    return lines.slice(0, MAX_LINES).join("\n") + `\n… (${lines.length - MAX_LINES} more lines)`
  }

  return (
    <box flexDirection="column" paddingLeft={2}>
      <Show
        when={expanded()}
        fallback={
          <text fg={colors.text.thinking} attributes={TextAttributes.DIM | TextAttributes.ITALIC}>
            {"\ud83d\udca1 Thinking (ctrl+o to expand)"}
          </text>
        }
      >
        <text fg={colors.text.thinking} attributes={TextAttributes.DIM | TextAttributes.ITALIC}>
          {"\ud83d\udca1 Thinking\u2026"}
        </text>
        <box flexDirection="row">
          <box width={2} flexShrink={0}>
            <text fg={colors.border.default}>{"\u2502"}</text>
          </box>
          <box flexGrow={1}>
            <markdown
              content={truncatedText()}
              syntaxStyle={syntaxStyle}
              fg={colors.text.thinking}
            />
          </box>
        </box>
      </Show>
    </box>
  )
}
