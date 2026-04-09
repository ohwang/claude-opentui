/**
 * StatusIcon — reusable status indicator primitive.
 *
 * Renders a colored icon for common statuses (success, error, running, etc.).
 * Used by CollapsedToolLine, ToolSummaryView, and any future status displays.
 */

import { TextAttributes } from "@opentui/core"
import { colors } from "../../theme/tokens"

export type StatusType = "success" | "error" | "warning" | "info" | "running" | "declined" | "pending"

/** Icon and attribute data per status (static — no color references) */
const STATUS_ICONS: Record<StatusType, { icon: string; attrs: number }> = {
  success:  { icon: "\u2713", attrs: TextAttributes.DIM },
  error:    { icon: "\u2717", attrs: 0 },
  warning:  { icon: "\u26A0", attrs: 0 },
  info:     { icon: "\u2139", attrs: TextAttributes.DIM },
  running:  { icon: "\u22EF", attrs: TextAttributes.DIM },
  declined: { icon: "\u21B3", attrs: 0 },
  pending:  { icon: "\u25CB", attrs: 0 },
}

/** Resolve the theme color for a status type (reactive — reads from store) */
function statusColor(status: StatusType): string {
  switch (status) {
    case "success":  return colors.status.success
    case "error":    return colors.status.error
    case "warning":  return colors.status.warning
    case "info":     return colors.status.info
    case "running":  return colors.accent.primary
    case "declined": return colors.text.muted
    case "pending":  return colors.text.muted
  }
}

export function StatusIcon(props: { status: StatusType; withSpace?: boolean }) {
  const icon = () => STATUS_ICONS[props.status]
  return (
    <box width={props.withSpace !== false ? 2 : undefined}>
      <text fg={statusColor(props.status)} attributes={icon().attrs}>
        {icon().icon}
      </text>
    </box>
  )
}

/** Get icon config without rendering — for inline text construction */
export function getStatusConfig(status: StatusType) {
  return { ...STATUS_ICONS[status], color: statusColor(status) }
}
