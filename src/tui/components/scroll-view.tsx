/**
 * ScrollView — Reusable scrollbox with auto-hide scrollbar
 *
 * Wraps OpenTUI's <scrollbox> with:
 * - Auto-hide scrollbar: hidden by default, shown on scroll, hidden after idle
 * - macOS-style scroll acceleration
 * - Styled scrollbar: no arrows, subtle thumb, transparent track
 * - Scroll change callback for parent components that need to track scroll state
 *
 * Use this instead of raw <scrollbox> anywhere you want a scrollbar that
 * matches Claude Code's behavior.
 */

import type { JSX } from "solid-js"
import { createEffect, onCleanup } from "solid-js"
import { type ScrollBoxRenderable, MacOSScrollAccel } from "@opentui/core"
import { colors } from "../theme/tokens"

const DEFAULT_HIDE_DELAY_MS = 1000

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
  /** Children */
  children?: JSX.Element
}

export function ScrollView(props: ScrollViewProps) {
  let scrollboxRef: ScrollBoxRenderable | undefined
  let scrollbarTimer: ReturnType<typeof setTimeout> | undefined
  const hideDelay = () => props.hideDelay ?? DEFAULT_HIDE_DELAY_MS

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
      // Style: no arrows, subtle thumb, transparent track
      scrollboxRef.verticalScrollBar.showArrows = false
      scrollboxRef.verticalScrollBar.slider.foregroundColor = colors.text.muted
      scrollboxRef.verticalScrollBar.slider.backgroundColor = "transparent"
      // Listen for all scroll position changes (mouse wheel, programmatic, keyboard)
      scrollboxRef.verticalScrollBar.on("change", () => {
        if (!scrollboxRef) return
        showScrollbarBriefly()
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
    >
      {props.children}
    </scrollbox>
  )
}
