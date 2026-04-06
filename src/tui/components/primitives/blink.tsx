/**
 * Blink primitive -- synchronized blinking for progress indicators.
 *
 * Uses the centralized AnimationContext clock. All BlinkingDot instances
 * share the same frame callback so they pulse in unison without needing
 * their own per-component timers.
 */

import { createSignal } from "solid-js"
import { useAnimationFrame } from "../../context/animation"
import { colors } from "../../theme/tokens"

const BLINK_INTERVAL_MS = 600

// ---------------------------------------------------------------------------
// useBlink — reactive hook powered by AnimationContext
// ---------------------------------------------------------------------------

/** Hook that returns a reactive blinking signal (true/false at 600ms) */
export function useBlink(): () => boolean {
  const [visible, setVisible] = createSignal(true)
  let accum = 0

  useAnimationFrame((dt) => {
    accum += dt
    if (accum >= BLINK_INTERVAL_MS) {
      accum -= BLINK_INTERVAL_MS
      setVisible((v) => !v)
    }
  })

  return visible
}

// ---------------------------------------------------------------------------
// BlinkingDot component
// ---------------------------------------------------------------------------

/**
 * BlinkingDot -- shows a filled circle that blinks when active,
 * stays solid when resolved.
 *
 * - active:   blinking grey circle
 * - success:  solid green circle
 * - error:    solid red circle
 * - declined: solid muted circle
 */
export function BlinkingDot(props: {
  status: "active" | "success" | "error" | "declined"
}) {
  const isVisible = useBlink()

  const char = () => {
    if (props.status === "active") {
      return isVisible() ? "\u25CF" : " " // Blink effect: filled circle or space
    }
    return "\u25CF" // Solid for resolved states
  }

  const color = () => {
    switch (props.status) {
      case "active":
        return colors.text.inactive
      case "success":
        return colors.status.success
      case "error":
        return colors.status.error
      case "declined":
        return colors.text.inactive
    }
  }

  return <text fg={color()}>{char()}</text>
}
