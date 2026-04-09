/**
 * Plan Block — Structured agent plan with status indicators
 *
 * Renders ACP plan entries as a visual checklist:
 *   ○ pending task
 *   ◉ in-progress task (accent color)
 *   ✓ completed task (green, dimmed)
 */

import { For } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { colors } from "../theme/tokens"
import type { PlanEntry } from "../../protocol/types"

const statusIcon = (status?: string) => {
  switch (status) {
    case "completed": return "\u2713"
    case "in_progress": return "\u25C9"
    default: return "\u25CB"
  }
}

const statusColor = (status?: string) => {
  switch (status) {
    case "completed": return colors.status.success
    case "in_progress": return colors.accent.primary
    default: return colors.text.muted
  }
}

const statusAttrs = (status?: string) => {
  if (status === "completed") return TextAttributes.DIM
  if (status === "in_progress") return TextAttributes.BOLD
  return 0
}

export function PlanBlock(props: { entries: PlanEntry[] }) {
  return (
    <box flexDirection="column" paddingLeft={2}>
      <text fg={colors.text.secondary} attributes={TextAttributes.DIM | TextAttributes.ITALIC}>
        {"Plan"}
      </text>
      <For each={props.entries}>
        {(entry) => (
          <box flexDirection="row" paddingLeft={1}>
            <text fg={statusColor(entry.status)} attributes={statusAttrs(entry.status)}>
              {`${statusIcon(entry.status)} `}
            </text>
            <text
              fg={entry.status === "completed" ? colors.text.muted : colors.text.primary}
              attributes={entry.status === "completed" ? TextAttributes.DIM : 0}
            >
              {entry.content}
            </text>
          </box>
        )}
      </For>
    </box>
  )
}
