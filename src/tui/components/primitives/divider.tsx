/**
 * Divider — full-width or fixed-width separator line.
 *
 * Replaces the duplicated "repeat dash" pattern in app.tsx (DashLine),
 * block-view.tsx (turn separator), and permission-dialog.tsx (dashedLine).
 */

import { useTerminalDimensions } from "@opentui/solid"
import { colors } from "../../theme/tokens"

export function Divider(props: {
  char?: string        // default "─"
  fg?: string          // default colors.border.muted
  width?: number       // default terminal width
  paddingLeft?: number // default 0
  paddingRight?: number // default 0
}) {
  const dims = useTerminalDimensions()
  const char = () => props.char ?? "\u2500"
  const color = () => props.fg ?? colors.border.muted
  const width = () => {
    if (props.width) return props.width
    const tw = dims()?.width ?? 120
    return tw - (props.paddingLeft ?? 0) - (props.paddingRight ?? 0)
  }
  const line = () => char().repeat(Math.max(width(), 20))

  return (
    <box height={1} width="100%">
      <text fg={color()}>{line()}</text>
    </box>
  )
}
