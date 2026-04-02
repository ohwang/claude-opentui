/**
 * Blink primitive -- synchronized blinking for progress indicators.
 *
 * All BlinkingDot instances share a single global clock so they pulse
 * in unison. The clock starts when the first subscriber mounts and
 * stops when the last unmounts (no idle timers).
 */

import { createSignal, onCleanup } from "solid-js"
import { colors } from "../../theme/tokens"

const BLINK_INTERVAL_MS = 600

// ---------------------------------------------------------------------------
// Global blink clock — shared across all subscribers
// ---------------------------------------------------------------------------

let globalBlinkState = true
let globalBlinkTimer: ReturnType<typeof setInterval> | undefined
let blinkSubscribers = 0

function subscribeBlink(): () => boolean {
  if (blinkSubscribers === 0) {
    globalBlinkTimer = setInterval(() => {
      globalBlinkState = !globalBlinkState
    }, BLINK_INTERVAL_MS)
  }
  blinkSubscribers++

  return () => globalBlinkState
}

function unsubscribeBlink(): void {
  blinkSubscribers--
  if (blinkSubscribers === 0 && globalBlinkTimer) {
    clearInterval(globalBlinkTimer)
    globalBlinkTimer = undefined
  }
}

// ---------------------------------------------------------------------------
// useBlink — reactive hook
// ---------------------------------------------------------------------------

/** Hook that returns a reactive blinking signal (true/false at 600ms) */
export function useBlink(): () => boolean {
  const getBlink = subscribeBlink()
  const [visible, setVisible] = createSignal(true)

  // Sample faster than the blink interval to stay in sync with the global clock
  const timer = setInterval(() => {
    setVisible(getBlink())
  }, BLINK_INTERVAL_MS / 2)

  onCleanup(() => {
    clearInterval(timer)
    unsubscribeBlink()
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
