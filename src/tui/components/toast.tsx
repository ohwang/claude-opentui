/**
 * Toast Display — Renders active toast notifications
 *
 * Positioned above the input area.
 * Each toast is a single-line <text> with type-appropriate prefix and color.
 */

import { For } from "solid-js"
import { useToast, type ToastType } from "../context/toast"
import { colors } from "../theme/tokens"

// ---------------------------------------------------------------------------
// Type -> style mapping
// ---------------------------------------------------------------------------

const TOAST_PREFIX: Record<ToastType, string> = {
  info: "\u2139",      // i
  success: "\u2713",   // checkmark
  warning: "\u26A0",   // warning sign
  error: "\u2717",     // x mark
}

const TOAST_COLOR: Record<ToastType, string> = {
  info: colors.status.info,
  success: colors.status.success,
  warning: colors.status.warning,
  error: colors.status.error,
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ToastDisplay() {
  const ctx = useToast()

  // Uses visible={false} instead of <Show> so the toast container keeps its
  // position in the layout tree. When toasts appear/disappear, the box simply
  // becomes visible rather than being inserted/removed, preventing layout
  // shifts around the input area.
  return (
    <box flexDirection="column" visible={ctx.toasts.length > 0}>
      <box flexDirection="column" paddingLeft={2}>
        <For each={ctx.toasts}>
          {(t) => (
            <box height={1}>
              <text fg={TOAST_COLOR[t.type]}>
                {`${TOAST_PREFIX[t.type]} ${t.message}`}
              </text>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}
