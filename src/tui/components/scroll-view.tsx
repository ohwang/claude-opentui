/**
 * ScrollView — Reusable scrollbox with auto-hide scrollbar and smooth scrolling
 *
 * Wraps OpenTUI's <scrollbox> with:
 * - Smooth scrolling via ANSI scroll regions (DECSTBM): instead of
 *   re-rendering all shifted cells, emit terminal scroll commands that
 *   modern terminals (Kitty, iTerm2) animate at the pixel level
 * - Auto-hide scrollbar: hidden by default, shown on scroll, hidden after idle
 * - Hidden at bottom: scrollbar stays hidden when at the bottom viewport
 * - macOS-style scroll acceleration
 * - Styled scrollbar: thin (1-char), no arrows, subtle thumb, transparent track
 * - Scroll change callback for parent components that need to track scroll state
 *
 * Use this instead of raw <scrollbox> anywhere you want a scrollbar that
 * matches Claude Code's behavior.
 */

import type { JSX } from "solid-js"
import { createEffect, onCleanup } from "solid-js"
import { type ScrollBoxRenderable, MacOSScrollAccel } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { colors } from "../theme/tokens"

const DEFAULT_HIDE_DELAY_MS = 1000
const NEAR_EDGE_THRESHOLD = 3

/** Check whether a scrollbox is at or near the bottom of its content */
function isNearBottom(ref: ScrollBoxRenderable): boolean {
  const viewportHeight = ref.viewport.height
  return ref.scrollTop + viewportHeight >= ref.scrollHeight - NEAR_EDGE_THRESHOLD
}

// ---------------------------------------------------------------------------
// ANSI scroll region commands (DECSTBM)
//
// Instead of letting OpenTUI re-render every shifted cell on scroll, we emit
// terminal scroll region commands. Modern terminals (Kitty, iTerm2) animate
// these at the pixel level, producing smooth sub-line scrolling.
//
// The sequence:
//   \e[{top};{bottom}r  — set scroll region boundaries
//   \e[{n}S             — scroll up n lines (content moves up, new row at bottom)
//   \e[{n}T             — scroll down n lines (content moves down, new row at top)
//   \e[r                — reset scroll region to full screen
//
// OpenTUI's next frame re-render will correct any discrepancies, since
// the terminal already has most rows in the right position.
// ---------------------------------------------------------------------------

function emitScrollRegion(top: number, bottom: number, delta: number): void {
  if (delta === 0) return
  const setRegion = `\x1b[${top};${bottom}r`
  const scroll = delta > 0
    ? `\x1b[${delta}S`   // scroll up (content moves up)
    : `\x1b[${-delta}T`  // scroll down (content moves down)
  const resetRegion = `\x1b[r`
  process.stdout.write(setRegion + scroll + resetRegion)
}

export interface ScrollViewProps {
  /** Ref callback — receives the underlying ScrollBoxRenderable */
  ref?: (el: ScrollBoxRenderable) => void
  /** Milliseconds before scrollbar hides after last scroll event. Default: 1000 */
  hideDelay?: number
  /** Called on every scroll position change (including mouse wheel).
   *  Receives the ScrollBoxRenderable so the parent can inspect scrollTop, etc. */
  onScroll?: (el: ScrollBoxRenderable) => void
  /** Enable sticky scroll (auto-scroll to anchor point on content change) */
  stickyScroll?: boolean
  /** Anchor point for sticky scroll */
  stickyStart?: "bottom" | "top" | "left" | "right"
  /** Flex grow */
  flexGrow?: number
  /** Background color for the scrollbox */
  backgroundColor?: string
  /** Enable smooth scrolling via terminal scroll regions (DECSTBM).
   *  Default: true. Disable if causing visual artifacts on your terminal. */
  smoothScroll?: boolean
  /** Children */
  children?: JSX.Element
}

export function ScrollView(props: ScrollViewProps) {
  let scrollboxRef: ScrollBoxRenderable | undefined
  let scrollbarTimer: ReturnType<typeof setTimeout> | undefined
  let lastScrollTop = 0
  const hideDelay = () => props.hideDelay ?? DEFAULT_HIDE_DELAY_MS
  const smoothScrollEnabled = () => props.smoothScroll !== false
  const dims = useTerminalDimensions()

  const showScrollbarBriefly = () => {
    if (!scrollboxRef) return
    scrollboxRef.verticalScrollBar.visible = true
    clearTimeout(scrollbarTimer)
    scrollbarTimer = setTimeout(() => {
      if (scrollboxRef) scrollboxRef.verticalScrollBar.visible = false
    }, hideDelay())
  }

  createEffect(() => {
    if (scrollboxRef) {
      // Start hidden
      scrollboxRef.verticalScrollBar.visible = false
      // Style: thin (1-char wide), no arrows, subtle thumb, transparent track
      scrollboxRef.verticalScrollBar.showArrows = false
      scrollboxRef.verticalScrollBar.width = 1
      scrollboxRef.verticalScrollBar.slider.foregroundColor = colors.text.muted
      scrollboxRef.verticalScrollBar.slider.backgroundColor = "transparent"
      // Initialize scroll tracking
      lastScrollTop = scrollboxRef.scrollTop

      scrollboxRef.verticalScrollBar.on("change", () => {
        if (!scrollboxRef) return
        const currentTop = scrollboxRef.scrollTop
        const delta = currentTop - lastScrollTop

        // Emit terminal scroll region command for smooth scrolling.
        // Only for small deltas (1-3 lines) — large jumps should re-render.
        // Skip when at bottom (auto-scroll from streaming content).
        if (smoothScrollEnabled() && delta !== 0 && Math.abs(delta) <= 3 && !isNearBottom(scrollboxRef)) {
          const termHeight = dims()?.height ?? 0
          if (termHeight > 0) {
            // Scroll region covers the scrollbox's viewport area.
            // Use 1-based terminal row coordinates.
            const viewportTop = 1
            const viewportBottom = termHeight
            emitScrollRegion(viewportTop, viewportBottom, delta)
          }
        }

        lastScrollTop = currentTop

        // Scrollbar visibility
        if (isNearBottom(scrollboxRef)) {
          scrollboxRef.verticalScrollBar.visible = false
          clearTimeout(scrollbarTimer)
        } else {
          showScrollbarBriefly()
        }
        props.onScroll?.(scrollboxRef)
      })
    }
  })

  onCleanup(() => {
    clearTimeout(scrollbarTimer)
    scrollboxRef?.verticalScrollBar.removeAllListeners("change")
  })

  return (
    <scrollbox
      ref={(el: ScrollBoxRenderable) => {
        scrollboxRef = el
        props.ref?.(el)
      }}
      stickyScroll={props.stickyScroll}
      stickyStart={props.stickyStart}
      scrollAcceleration={new MacOSScrollAccel()}
      flexGrow={props.flexGrow}
      backgroundColor={props.backgroundColor}
    >
      {props.children}
    </scrollbox>
  )
}
