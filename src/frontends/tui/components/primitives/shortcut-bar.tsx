/**
 * ShortcutBar -- horizontal row of shortcut hints separated by middots.
 *
 * Wraps children in a Byline for " . " separation.
 *
 * @example
 * <ShortcutBar>
 *   <ShortcutHint shortcut="Enter" action="select" />
 *   <ShortcutHint shortcut="Esc" action="cancel" />
 * </ShortcutBar>
 * // Renders: "Enter to select . Esc to cancel"
 */

import type { JSX } from "solid-js"
import { Byline } from "./byline"

export function ShortcutBar(props: { children: JSX.Element }) {
  return (
    <box flexDirection="row">
      <Byline>{props.children as JSX.Element[]}</Byline>
    </box>
  )
}
