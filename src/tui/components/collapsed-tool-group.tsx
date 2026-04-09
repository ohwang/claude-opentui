/**
 * CollapsedToolGroup — renders a grouped summary for consecutive collapsible tools.
 *
 * Displays a single line like:
 *   ● 4 tool uses (3 reads, 1 search) — 2.1s
 *
 * Uses BlinkingDot for status indication (blinking when running, solid when done).
 */

import { TextAttributes } from "@opentui/core"
import { BlinkingDot } from "./primitives"
import { colors } from "../theme/tokens"
import type { ToolGroup } from "../utils/tool-grouping"
import { formatGroupSummary, formatDuration } from "../utils/tool-grouping"
import { createThrottledValue } from "../../utils/throttled-value"

export function CollapsedToolGroup(props: { group: ToolGroup }) {
  const g = () => props.group
  const groupStatus = createThrottledValue(() => g().status)

  const dotStatus = (): "active" | "success" | "error" | "declined" => {
    const s = groupStatus()
    if (s === "running") return "active"
    if (s === "error") return "error"
    return "success"
  }

  const summaryText = () => {
    const summary = formatGroupSummary(g())
    const dur = formatDuration(g().totalDuration)
    return dur ? `${summary} — ${dur}` : summary
  }

  const textColor = () => {
    if (groupStatus() === "error") return colors.status.error
    return colors.text.inactive
  }

  return (
    <box flexDirection="row">
      <box width={2} flexShrink={0}>
        <BlinkingDot status={dotStatus()} />
      </box>
      <text
        fg={textColor()}
        attributes={TextAttributes.DIM}
      >
        {summaryText()}
      </text>
    </box>
  )
}
