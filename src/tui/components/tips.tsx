/**
 * Contextual Tips — State-aware keyboard hints
 *
 * Shows a single line of dim tips above the input area that change
 * based on the current session state. Helps users discover features
 * without reading docs.
 */

import { Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useSession } from "../context/session"
import { colors } from "../theme/tokens"

const TIPS: Record<string, string[]> = {
  IDLE: [
    "Type a message and press Enter to send",
    "/help for commands \u00b7 Ctrl+P to switch models \u00b7 Shift+Tab for permission mode",
    "Ctrl+D twice to exit \u00b7 /new to start fresh",
  ],
  RUNNING: [
    "Ctrl+C to interrupt \u00b7 Ctrl+O to expand tool output",
  ],
  WAITING_FOR_PERM: [
    "y=allow \u00b7 a=always \u00b7 n=deny \u00b7 d=deny session \u00b7 Esc=deny",
  ],
  WAITING_FOR_ELIC: [
    "Arrow keys to navigate \u00b7 Enter to select \u00b7 Esc to cancel",
  ],
}

export function ContextualTips() {
  const { state } = useSession()

  // Pick a tip for the current state.
  // Use turnNumber as a stable index so tips don't flicker during re-renders.
  const tip = () => {
    const stateTips = TIPS[state.sessionState] ?? TIPS.IDLE ?? []
    if (stateTips.length === 0) return ""
    return stateTips[state.turnNumber % stateTips.length] ?? stateTips[0]
  }

  return (
    <Show when={tip()}>
      <box paddingLeft={2}>
        <text fg={colors.text.muted} attributes={TextAttributes.DIM}>
          {tip()}
        </text>
      </box>
    </Show>
  )
}
