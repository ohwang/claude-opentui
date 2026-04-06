/**
 * StatusIcon — reusable status indicator primitive.
 *
 * Renders a colored icon for common statuses (success, error, running, etc.).
 * Used by CollapsedToolLine, ToolSummaryView, and any future status displays.
 */

import { TextAttributes } from "@opentui/core"
import { colors } from "../../theme/tokens"

export type StatusType = "success" | "error" | "warning" | "info" | "running" | "declined" | "pending"

const STATUS_CONFIG: Record<StatusType, { icon: string; color: string; attrs: number }> = {
  success:  { icon: "\u2713", color: colors.status.success, attrs: TextAttributes.DIM },
  error:    { icon: "\u2717", color: colors.status.error,   attrs: 0 },
  warning:  { icon: "\u26A0", color: colors.status.warning, attrs: 0 },
  info:     { icon: "\u2139", color: colors.status.info,    attrs: TextAttributes.DIM },
  running:  { icon: "\u22EF", color: colors.accent.primary, attrs: TextAttributes.DIM },
  declined: { icon: "\u21B3", color: colors.text.inactive,  attrs: TextAttributes.DIM },
  pending:  { icon: "\u25CB", color: colors.text.inactive,  attrs: TextAttributes.DIM },
}

export function StatusIcon(props: { status: StatusType; withSpace?: boolean }) {
  const config = () => STATUS_CONFIG[props.status]
  return (
    <box width={props.withSpace !== false ? 2 : undefined}>
      <text fg={config().color} attributes={config().attrs}>
        {config().icon}
      </text>
    </box>
  )
}

/** Get icon config without rendering — for inline text construction */
export function getStatusConfig(status: StatusType) {
  return STATUS_CONFIG[status]
}
