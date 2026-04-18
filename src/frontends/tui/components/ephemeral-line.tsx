/**
 * EphemeralLine -- A single-row ephemeral message area.
 *
 * Always occupies exactly 1 row of vertical space. When a message is
 * provided, it renders as dimmed, de-emphasized text (suitable for
 * transient hints like view-level notifications or interrupt prompts).
 * When no message is provided, it renders as an empty blank line,
 * preserving layout stability so surrounding components don't shift.
 */

import { Show } from "solid-js"
import { colors } from "../theme/tokens"

export interface EphemeralLineProps {
  message?: string | null
}

export function EphemeralLine(props: EphemeralLineProps) {
  return (
    <box height={1} flexShrink={0} paddingLeft={2}>
      <Show when={props.message}>
        <text fg={colors.text.muted}>{props.message}</text>
      </Show>
    </box>
  )
}
