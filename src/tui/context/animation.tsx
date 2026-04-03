/**
 * AnimationContext — Centralized animation frame clock.
 *
 * Provides a single setInterval-based clock that all animated components
 * share, avoiding per-component timers fighting for CPU. Inspired by
 * Claude Code's ClockContext/useAnimationFrame pattern.
 *
 * Components opt into animation updates via:
 *   - useAnimationFrame(cb) — per-frame callback with delta-time
 *   - useAnimation(duration, opts?) — returns a 0→1 progress signal
 *   - useReducedMotion() — check if animations should be skipped
 *
 * The clock auto-starts when the first subscriber registers and stops
 * when the last unsubscribes (no idle timers).
 */

import {
  createContext,
  useContext,
  createSignal,
  onMount,
  onCleanup,
  createEffect,
  type ParentProps,
} from "solid-js"
import { linear } from "../theme/easing"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnimationContextValue {
  /** Register a per-frame callback. Returns a cleanup function. */
  onFrame: (callback: (dt: number) => void) => () => void
  /** Current frame timestamp (ms since clock start). */
  now: () => number
}

export interface AnimationOptions {
  /** Delay before the animation starts (ms). Default: 0. */
  delay?: number
  /** Easing function mapping linear 0→1 to curved 0→1. Default: linear. */
  easing?: (t: number) => number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Frame interval in ms. ~60fps equivalent. */
const FRAME_INTERVAL_MS = 16

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AnimationContext = createContext<AnimationContextValue>()

export function AnimationProvider(props: ParentProps) {
  type FrameCallback = (dt: number) => void

  const subscribers = new Set<FrameCallback>()
  let timer: ReturnType<typeof setInterval> | undefined
  let lastTick = Date.now()
  const [now, setNow] = createSignal(Date.now())

  const startClock = () => {
    if (timer != null) return
    lastTick = Date.now()
    timer = setInterval(() => {
      const current = Date.now()
      const dt = current - lastTick
      lastTick = current
      setNow(current)
      for (const cb of subscribers) {
        cb(dt)
      }
    }, FRAME_INTERVAL_MS)
  }

  const stopClock = () => {
    if (timer != null) {
      clearInterval(timer)
      timer = undefined
    }
  }

  const onFrame = (callback: FrameCallback): (() => void) => {
    subscribers.add(callback)
    if (subscribers.size === 1) startClock()

    return () => {
      subscribers.delete(callback)
      if (subscribers.size === 0) stopClock()
    }
  }

  onCleanup(stopClock)

  const value: AnimationContextValue = {
    onFrame,
    now,
  }

  return (
    <AnimationContext.Provider value={value}>
      {props.children}
    </AnimationContext.Provider>
  )
}

export function useAnimationContext(): AnimationContextValue {
  const ctx = useContext(AnimationContext)
  if (!ctx) throw new Error("useAnimationContext must be used within AnimationProvider")
  return ctx
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Register a per-frame callback that receives delta-time (ms) since
 * the previous frame. Automatically cleaned up when the component unmounts.
 */
export function useAnimationFrame(callback: (dt: number) => void): void {
  const ctx = useAnimationContext()
  onMount(() => {
    const cleanup = ctx.onFrame(callback)
    onCleanup(cleanup)
  })
}

/**
 * Run a timed animation. Returns a reactive accessor that yields 0→1
 * over the given duration (with optional delay and easing).
 *
 * After the animation completes, the value stays at 1 and the frame
 * callback is automatically removed.
 */
export function useAnimation(
  durationMs: number,
  opts?: AnimationOptions,
): () => number {
  const ctx = useAnimationContext()
  const easing = opts?.easing ?? linear
  const delay = opts?.delay ?? 0
  const [progress, setProgress] = createSignal(0)

  onMount(() => {
    const startTime = Date.now()

    const cleanup = ctx.onFrame(() => {
      const elapsed = Date.now() - startTime - delay
      if (elapsed <= 0) {
        setProgress(0)
        return
      }
      const raw = Math.min(elapsed / durationMs, 1)
      setProgress(easing(raw))
      if (raw >= 1) {
        cleanup()
      }
    })

    onCleanup(cleanup)
  })

  return progress
}

/**
 * Returns a reactive boolean indicating whether reduced-motion is preferred.
 *
 * Checks the REDUCE_MOTION environment variable. When true, animations
 * should be skipped or shortened to static states.
 */
export function useReducedMotion(): () => boolean {
  const envVal = process.env.REDUCE_MOTION ?? process.env.OPENTUI_REDUCE_MOTION ?? ""
  const reduced = envVal === "1" || envVal.toLowerCase() === "true"
  return () => reduced
}
