/**
 * Reactive render throttle for SolidJS.
 *
 * Decouples state-update rate (16ms event batches) from visual-update rate
 * (~100ms). Any store value that changes faster than the throttle window
 * is coalesced — intermediate states that exist for <100ms never get
 * painted, eliminating the "flash of intermediate state" problem.
 *
 * Local signals, timers, and animations are unaffected — only values
 * routed through this utility are throttled.
 *
 * Same pattern as OpenCode's createThrottledValue (message-part.tsx).
 */

import { createSignal, createEffect, onCleanup, type Accessor } from "solid-js"

const RENDER_THROTTLE_MS = 100

/**
 * Returns a throttled accessor that updates at most once per `intervalMs`.
 *
 * - First value is returned immediately (no initial delay).
 * - When the source changes faster than the throttle window, only the
 *   latest value is delivered after the window expires.
 * - Cleanup cancels any pending timer (safe for SolidJS ownership).
 *
 * @param source  Reactive accessor to throttle (e.g. `() => state.streamingText`)
 * @param intervalMs  Minimum ms between updates (default: 100)
 */
export function createThrottledValue<T>(source: Accessor<T>, intervalMs: number = RENDER_THROTTLE_MS): Accessor<T> {
  const [value, setValue] = createSignal<T>(source())
  let timeout: ReturnType<typeof setTimeout> | undefined
  let lastFlush = 0

  createEffect(() => {
    const next = source()
    const now = Date.now()
    const remaining = intervalMs - (now - lastFlush)

    if (remaining <= 0) {
      // Window expired — flush immediately
      if (timeout) {
        clearTimeout(timeout)
        timeout = undefined
      }
      lastFlush = now
      setValue(() => next)
      return
    }

    // Within window — schedule trailing flush with latest value
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => {
      lastFlush = Date.now()
      setValue(() => next)
      timeout = undefined
    }, remaining)
  })

  onCleanup(() => {
    if (timeout) clearTimeout(timeout)
  })

  return value
}
