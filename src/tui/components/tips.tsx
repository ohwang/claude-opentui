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
    "/help for commands \u00b7 Ctrl+Shift+P to switch models \u00b7 Shift+Tab for permission mode",
  ],
  RUNNING: [
    "Ctrl+C to interrupt \u00b7 Ctrl+O to expand tool output",
  ],
}

export function ContextualTips() {
  const { state } = useSession()

  // Pick a tip for the current state.
  // Use turnNumber as a stable index so tips don't flicker during re-renders.
  // Hide tips entirely during dialog states — the dialog provides its own hints.
  const tip = () => {
    const s = state.sessionState
    if (s === "WAITING_FOR_PERM" || s === "WAITING_FOR_ELIC") return ""
    const stateTips = TIPS[s] ?? TIPS.IDLE ?? []
    if (stateTips.length === 0) return ""

    // For IDLE: show basic tip only on first turn, then cycle remaining
    if (s === "IDLE" && stateTips.length > 1) {
      if (state.turnNumber === 0) return stateTips[0] ?? ""
      // After first turn, cycle through tips 1+ (skip the basic instruction)
      const advancedTips = stateTips.slice(1)
      return advancedTips[(state.turnNumber - 1) % advancedTips.length] ?? ""
    }

    return stateTips[state.turnNumber % stateTips.length] ?? stateTips[0]
  }

  return (
    <Show when={tip()}>
      <box paddingLeft={2}>
        <text fg={colors.text.inactive} attributes={TextAttributes.DIM}>
          {tip()}
        </text>
      </box>
    </Show>
  )
}
