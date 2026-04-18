/**
 * ScrollView — Reusable scrollbox with auto-hide scrollbar
 *
 * Wraps OpenTUI's <scrollbox> with:
 * - Auto-hide scrollbar: hidden by default, shown on scroll, hidden after idle
 * - Hidden at bottom: scrollbar stays hidden when at the bottom viewport
 * - macOS-style scroll acceleration
 * - Styled scrollbar: thin (1-char), no arrows, subtle thumb, transparent track
 * - Scroll change callback for parent components that need to track scroll state
 *
 * Layout stability: The scrollbar is always present in layout (Display.Flex)
 * to prevent content reflow. Visibility is controlled by toggling the slider's
 * foreground color between transparent and visible, not by toggling the
 * scrollbar's `visible` property (which uses Display.None and causes the
 * content area width to change, reflowing text).
 *
 * Note: Smooth sub-line scrolling requires upstream OpenTUI support for ANSI
 * scroll regions (DECSTBM). See team/docs/upstream/scrollbox-sub-line-scrolling.md
 * for the implementation plan. Application-layer workarounds don't work because
 * OpenTUI's cell-by-cell re-render overwrites any scroll region commands we emit.
 */

import type { JSX } from "solid-js"
import { createEffect, onCleanup } from "solid-js"
import { type ScrollBoxRenderable, MacOSScrollAccel } from "@opentui/core"
import { colors } from "../theme/tokens"

const DEFAULT_HIDE_DELAY_MS = 1000
const NEAR_EDGE_THRESHOLD = 3

/** Check whether a scrollbox is at or near the bottom of its content */
function isNearBottom(ref: ScrollBoxRenderable): boolean {
  const viewportHeight = ref.viewport.height
  return ref.scrollTop + viewportHeight >= ref.scrollHeight - NEAR_EDGE_THRESHOLD
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
  /** Children */
  children?: JSX.Element
}

export function ScrollView(props: ScrollViewProps) {
  let scrollboxRef: ScrollBoxRenderable | undefined
  let scrollbarTimer: ReturnType<typeof setTimeout> | undefined
  const hideDelay = () => props.hideDelay ?? DEFAULT_HIDE_DELAY_MS

  /** Make the scrollbar thumb visible (muted color) */
  const showSlider = () => {
    if (!scrollboxRef) return
    scrollboxRef.verticalScrollBar.slider.foregroundColor = colors.text.muted
  }

  /** Make the scrollbar thumb invisible (transparent, but still in layout) */
  const hideSlider = () => {
    if (!scrollboxRef) return
    scrollboxRef.verticalScrollBar.slider.foregroundColor = "transparent"
  }

  const showScrollbarBriefly = () => {
    if (!scrollboxRef) return
    showSlider()
    clearTimeout(scrollbarTimer)
    scrollbarTimer = setTimeout(() => hideSlider(), hideDelay())
  }

  createEffect(() => {
    if (scrollboxRef) {
      // Style: thin (1-char wide), no arrows, transparent track.
      // The scrollbar stays in layout (visible=true) at all times to prevent
      // content width changes. We toggle the slider color for show/hide.
      scrollboxRef.verticalScrollBar.showArrows = false
      scrollboxRef.verticalScrollBar.width = 1
      scrollboxRef.verticalScrollBar.slider.backgroundColor = "transparent"
      // Start with invisible thumb
      hideSlider()
      // Listen for all scroll position changes (mouse wheel, programmatic, keyboard).
      // Hide scrollbar at bottom: changes at the bottom are from sticky auto-scroll,
      // not user interaction, and flashing the scrollbar is distracting.
      scrollboxRef.verticalScrollBar.on("change", () => {
        if (!scrollboxRef) return
        if (isNearBottom(scrollboxRef)) {
          hideSlider()
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
