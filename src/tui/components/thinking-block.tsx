/**
 * Thinking Block — Collapsible thinking content with blockquote style
 *
 * Shows Claude's reasoning process in a markdown-blockquote visual:
 * a left border bar (▎) with content indented beside it.
 *
 * Collapsed: "💡 Thinking (ctrl+o to expand)"
 * Expanded:
 *   ▎ 💡 Thinking…
 *   ▎ <markdown content>
 */

import { Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import type { BorderCharacters } from "@opentui/core"
import { colors } from "../theme/tokens"
import { syntaxStyle } from "../theme"

/** Custom border chars: only the vertical char matters (left-border-only). */
const blockquoteBorder: BorderCharacters = {
  topLeft: " ", topRight: " ", bottomLeft: " ", bottomRight: " ",
  horizontal: " ", vertical: "▎",
  topT: " ", bottomT: " ", leftT: " ", rightT: " ", cross: " ",
}

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
        <box
          flexDirection="column"
          border={["left"] as any}
          borderColor={colors.border.default}
          customBorderChars={blockquoteBorder}
          paddingLeft={1}
        >
          <text fg={colors.text.thinking} attributes={TextAttributes.DIM | TextAttributes.ITALIC}>
            {"\ud83d\udca1 Thinking\u2026"}
          </text>
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
