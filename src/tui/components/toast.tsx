/**
 * Toast Display — Renders active toast notifications
 *
 * Positioned between the unseen-content pill and the input area.
 * Each toast is a single-line <text> with type-appropriate prefix and color.
 */

import { Show, For } from "solid-js"
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

  return (
    <box flexDirection="column">
      <Show when={ctx.toasts.length > 0}>
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
      </Show>
    </box>
  )
}
