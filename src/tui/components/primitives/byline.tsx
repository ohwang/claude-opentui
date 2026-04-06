/**
 * Byline — joins children with middot separator (" · ") for inline metadata.
 *
 * Named after the publishing term "byline" — the line of metadata below a title.
 * Automatically filters out null/undefined/false children.
 *
 * @example
 * <Byline>
 *   <text>Enter to confirm</text>
 *   <text>Esc to cancel</text>
 * </Byline>
 * // Renders: "Enter to confirm · Esc to cancel"
 */

import type { JSX } from "solid-js"
import { For } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { colors } from "../../theme/tokens"

export function Byline(props: { children: JSX.Element[] }) {
  // Filter out falsy children
  const validChildren = () => {
    const c = props.children
    if (!c) return []
    const arr = Array.isArray(c) ? c : [c]
    return arr.filter(Boolean)
  }

  return (
    <>
      <For each={validChildren()}>
        {(child, index) => (
          <>
            {index() > 0 && (
              <text fg={colors.text.inactive} attributes={TextAttributes.DIM}>{" · "}</text>
            )}
            {child}
          </>
        )}
      </For>
    </>
  )
}
