/**
 * Blink primitive -- synchronized blinking for progress indicators.
 *
 * Uses the centralized AnimationContext clock with absolute-time derivation.
 * Visibility is computed from `Date.now()` so that all BlinkingDot instances
 * produce the same value on each frame tick, regardless of when they were
 * mounted. This keeps every indicator blinking in perfect unison.
 */

import { createSignal } from "solid-js"
import { useAnimationFrame } from "../../context/animation"
import { colors } from "../../theme/tokens"

const BLINK_INTERVAL_MS = 600

// ---------------------------------------------------------------------------
// useBlink — reactive hook powered by AnimationContext
// ---------------------------------------------------------------------------

/** Hook that returns a reactive blinking signal (true/false at 600ms).
 *  Derives visibility from absolute time so all instances stay in phase. */
export function useBlink(): () => boolean {
  const [visible, setVisible] = createSignal(true)

  useAnimationFrame(() => {
    // Derive from absolute time — all instances compute the same value
    const shouldBeVisible = Math.floor(Date.now() / BLINK_INTERVAL_MS) % 2 === 0
    setVisible(shouldBeVisible)
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
        return colors.text.muted
      case "success":
        return colors.status.success
      case "error":
        return colors.status.error
      case "declined":
        return colors.text.muted
    }
  }

  return <text fg={color()}>{char()}</text>
}
