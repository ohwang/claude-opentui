/**
 * A/B Session Pane — one side of the split-pane execution view.
 *
 * Renders streaming text + live stats for one A/B session. Pure component:
 * the orchestrator owns the SessionStats accessor; this just renders.
 *
 * The "scroll independently" goal is satisfied by giving each pane its own
 * <scrollbox stickyScroll stickyStart="bottom">. The parent (split-pane.tsx)
 * decides which pane is focused — when focused, we render a brighter border
 * so the user knows where Page Up / Page Down will scroll.
 */

import { TextAttributes } from "@opentui/core"
import { createMemo, Show } from "solid-js"
import type { ScrollBoxRenderable } from "@opentui/core"
import type { SessionStats, Label } from "../../../ab/types"
import type { DiffStats } from "../../../utils/git-worktree"
import { friendlyBackendName, friendlyModelName } from "../../../protocol/models"
import { colors } from "../../theme/tokens"

export interface SessionPaneProps {
  label: Label
  stats: SessionStats
  diff?: DiffStats | null
  focused: boolean
  /** Optional ref callback for the scrollbox so the parent can drive Page Up/Down. */
  onScrollboxRef?: (el: ScrollBoxRenderable) => void
}

export function SessionPane(props: SessionPaneProps) {
  const accent = () =>
    props.focused ? colors.accent.primary : colors.border.default
  const elapsed = createMemo(() => {
    const s = props.stats
    if (!s.startTime) return ""
    const end = s.endTime ?? Date.now()
    const sec = Math.max(0, Math.round((end - s.startTime) / 1000))
    return `${sec}s`
  })
  const statusText = createMemo<string>(() => {
    const s = props.stats
    if (s.error) return `error: ${s.error}`
    if (s.interrupted) return "interrupted"
    if (s.complete) return "complete"
    return "running…"
  })
  const statusColor = createMemo(() => {
    const s = props.stats
    if (s.error) return colors.status.error
    if (s.interrupted) return colors.status.warning
    if (s.complete) return colors.status.success
    return colors.status.info
  })

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      minWidth={20}
      borderStyle="single"
      borderColor={accent()}
    >
      {/* Header */}
      <box flexDirection="column" padding={1} flexShrink={0}>
        <text
          fg={props.focused ? colors.accent.primary : colors.text.primary}
          attributes={TextAttributes.BOLD}
        >
          {`${props.focused ? "▶ " : "  "}${props.label} · ${friendlyBackendName(props.stats.backendId)}${props.stats.model ? ` (${friendlyModelName(props.stats.model)})` : ""}`}
        </text>
        <text fg={statusColor()}>
          {statusText()}
        </text>
      </box>

      {/* Streaming output */}
      <box flexGrow={1} flexShrink={1} minHeight={5} paddingLeft={1} paddingRight={1}>
        <scrollbox
          stickyScroll={true}
          stickyStart="bottom"
          ref={props.onScrollboxRef}
        >
          <text fg={colors.text.primary}>
            {props.stats.output || "(no output yet)"}
          </text>
        </scrollbox>
      </box>

      {/* Live stats footer */}
      <box flexDirection="column" padding={1} flexShrink={0}>
        <text fg={colors.text.secondary}>
          {`turns ${props.stats.turns}  tools ${props.stats.toolUseCount}  in ${props.stats.inputTokens}  out ${props.stats.outputTokens}`}
        </text>
        <text fg={colors.text.secondary}>
          {`cost $${props.stats.totalCostUsd.toFixed(4)}  time ${elapsed()}`}
        </text>
        <Show when={props.diff != null}>
          <text fg={colors.text.muted}>
            {`files ${props.diff!.filesChanged} (+${props.diff!.insertions}/-${props.diff!.deletions})`}
          </text>
        </Show>
        <Show when={props.stats.filesTouched.length > 0 && (!props.diff || props.diff.filesChanged === 0)}>
          <text fg={colors.text.muted}>
            {`tools touched ${props.stats.filesTouched.length} file(s)`}
          </text>
        </Show>
      </box>
    </box>
  )
}
