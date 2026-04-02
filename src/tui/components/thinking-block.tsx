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
  const expanded = () => !props.collapsed
  const text = () => props.text ?? ""

  return (
    <box flexDirection="column" paddingLeft={2}>
      <Show
        when={expanded()}
        fallback={
          <text fg={colors.text.muted} attributes={TextAttributes.DIM | TextAttributes.ITALIC}>
            {"\u2234 Thinking (ctrl+o to expand)"}
          </text>
        }
      >
        <text fg={colors.text.muted} attributes={TextAttributes.DIM | TextAttributes.ITALIC}>
          {"\u2234 Thinking\u2026"}
        </text>
        <box paddingLeft={2}>
          <markdown
            content={text()}
            syntaxStyle={syntaxStyle}
            fg={colors.text.muted}
          />
        </box>
      </Show>
    </box>
  )
}
