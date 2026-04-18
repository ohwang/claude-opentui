/**
 * Divider — full-width or fixed-width separator line.
 *
 * Replaces the duplicated "repeat dash" pattern in app.tsx (DashLine),
 * block-view.tsx (turn separator), and permission-dialog.tsx (dashedLine).
 *
 * Rendering note: the `<text>` child uses `wrapMode="none"` so the dash string
 * is always measured as a single row. With the default `wrapMode="word"`,
 * a dash string longer than the available cell width (e.g. inside a scrollbox
 * whose padding+scrollbar shaves 2 cells off the terminal width) was measured
 * as multi-line by OpenTUI's Zig measure pass. The outer box then clipped
 * render to 1 row but left phantom cells in the buffer — when the composer's
 * dynamic-height textarea grew and layout shifted the divider vertically,
 * those phantom cells didn't get cleared and the top divider showed only
 * the first few dashes. `wrapMode="none"` keeps measurement single-line;
 * OpenTUI clips horizontal overflow to the box bounds at render time.
 * `flexShrink={0}` on the outer box pins its height at 1 row so flex siblings
 * can't collapse it.
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
    <box height={1} width="100%" flexShrink={0}>
      <text wrapMode="none" fg={color()}>{line()}</text>
    </box>
  )
}
