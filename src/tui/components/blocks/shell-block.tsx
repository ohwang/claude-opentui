/**
 * ShellBlock -- renders a user-initiated ! shell command with truncated output.
 *
 * Matches Claude Code's shell output UX:
 * - Command header: "! command" with highlighted background
 * - Output body: first 3 lines visible, rest collapsed
 * - Expand hint: "... +N lines (ctrl+o to expand)"
 */

import { Show, createMemo } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { colors } from "../../theme/tokens"
import type { Block } from "../../../protocol/types"
import type { ViewLevel } from "../tool-view"

type ShellBlockType = Extract<Block, { type: "shell" }>

/** Maximum lines to show before truncating (matches Claude Code's 3-line threshold) */
const MAX_VISIBLE_LINES = 3

export function ShellBlock(props: { block: ShellBlockType; viewLevel: ViewLevel }) {
  const b = () => props.block

  /** Should we show full output (not truncated)? */
  const showFull = () => props.viewLevel !== "collapsed"

  /** Split output into lines, compute truncation */
  const outputInfo = createMemo(() => {
    const raw = b().output || ""
    if (!raw) return { lines: [] as string[], totalLines: 0, truncated: false, hiddenCount: 0 }

    const lines = raw.split("\n")
    // Remove trailing empty line from the split (common with command output ending in \n)
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop()
    }
    const totalLines = lines.length
    const truncated = !showFull() && totalLines > MAX_VISIBLE_LINES
    const hiddenCount = truncated ? totalLines - MAX_VISIBLE_LINES : 0
    return { lines, totalLines, truncated, hiddenCount }
  })

  /** Lines to actually display */
  const visibleLines = createMemo(() => {
    const info = outputInfo()
    if (info.truncated) {
      return info.lines.slice(0, MAX_VISIBLE_LINES)
    }
    return info.lines
  })

  /** Status-aware command color */
  const cmdColor = () => {
    if (b().status === "running") return colors.accent.primary
    if (b().status === "error") return colors.status.error
    return colors.text.white
  }

  return (
    <box flexDirection="column" marginTop={1}>
      {/* Command header: ! command -- with highlighted background like user message */}
      <box flexDirection="row" bg={colors.bg.surface} paddingRight={1}>
        <box width={2} flexShrink={0}>
          <text fg={colors.accent.primary} attributes={TextAttributes.BOLD}>{"!"}</text>
        </box>
        <text fg={cmdColor()}>{b().command}</text>
      </box>

      {/* Running indicator */}
      <Show when={b().status === "running"}>
        <box flexDirection="row">
          <box width={2} flexShrink={0}>
            <text fg={colors.text.muted}>{"\u23BF"}</text>
          </box>
          <text fg={colors.text.muted} attributes={TextAttributes.DIM}>{"Running\u2026"}</text>
        </box>
      </Show>

      {/* Output lines with connector */}
      <Show when={b().status !== "running" && outputInfo().totalLines > 0}>
        <box flexDirection="column">
          {visibleLines().map((line, i) => (
            <box flexDirection="row">
              <box width={2} flexShrink={0}>
                <text fg={colors.text.muted}>{i === 0 ? "\u23BF" : " "}</text>
              </box>
              <text fg={b().error && b().exitCode !== 0 ? colors.status.error : colors.text.secondary}>{line || " "}</text>
            </box>
          ))}

          {/* Truncation hint */}
          <Show when={outputInfo().truncated}>
            <box flexDirection="row">
              <box width={2} flexShrink={0}>
                <text fg={colors.text.muted}>{" "}</text>
              </box>
              <text fg={colors.text.muted} attributes={TextAttributes.DIM}>
                {`\u2026 +${outputInfo().hiddenCount} lines (ctrl+o to expand)`}
              </text>
            </box>
          </Show>
        </box>
      </Show>

      {/* Error with no output -- show error message */}
      <Show when={b().status === "error" && !b().output}>
        <box flexDirection="row">
          <box width={2} flexShrink={0}>
            <text fg={colors.text.muted}>{"\u23BF"}</text>
          </box>
          <text fg={colors.status.error}>{b().error || "Command failed"}</text>
        </box>
      </Show>

      {/* Empty output -- show subtle indicator */}
      <Show when={b().status === "done" && !b().output}>
        <box flexDirection="row">
          <box width={2} flexShrink={0}>
            <text fg={colors.text.muted}>{"\u23BF"}</text>
          </box>
          <text fg={colors.text.muted} attributes={TextAttributes.DIM}>{"(no output)"}</text>
        </box>
      </Show>
    </box>
  )
}
