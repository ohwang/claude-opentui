/**
 * Thinking Block — Collapsible thinking content
 *
 * Shows Claude's reasoning process.
 * Collapsed: "∴ Thinking (ctrl+o to expand)"
 * Expanded: "∴ Thinking…" then dim markdown content
 * Matches Claude Code's AssistantThinkingMessage pattern.
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
            {"\u2234 Thinking (ctrl+o to expand)"}
          </text>
        }
      >
        <text fg={colors.text.thinking} attributes={TextAttributes.DIM | TextAttributes.ITALIC}>
          {"\u2234 Thinking\u2026"}
        </text>
        <box paddingLeft={2}>
          <markdown
            content={truncatedText()}
            syntaxStyle={syntaxStyle}
            fg={colors.text.thinking}
          />
        </box>
      </Show>
    </box>
  )
}
