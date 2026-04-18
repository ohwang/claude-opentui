/**
 * Toast Context — Transient notification queue
 *
 * Manages a queue of toast notifications that auto-dismiss after a duration.
 * Max 3 visible toasts; oldest dismissed when exceeded.
 *
 * Module-level `toast` convenience object is usable outside the component tree:
 *   toast.info("msg"), toast.success("msg"), toast.warn("msg"), toast.error("msg")
 */

import {
  createContext,
  useContext,
  type ParentProps,
} from "solid-js"
import { createStore, produce } from "solid-js/store"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToastType = "info" | "success" | "warning" | "error"

export interface Toast {
  id: string
  type: ToastType
  message: string
  durationMs: number
}

export interface ToastContextValue {
  toasts: Toast[]
  showToast: (type: ToastType, message: string, durationMs?: number) => void
  dismissToast: (id: string) => void
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_DURATION: Record<ToastType, number> = {
  info: 2500,
  success: 2500,
  warning: 4000,
  error: 4000,
}

const MAX_VISIBLE = 3

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ToastContext = createContext<ToastContextValue>()

let _nextId = 0
function nextToastId(): string {
  return `toast-${++_nextId}`
}

// Active auto-dismiss timers keyed by toast id
const _timers = new Map<string, ReturnType<typeof setTimeout>>()

export function ToastProvider(props: ParentProps) {
  const [state, setState] = createStore<{ toasts: Toast[] }>({ toasts: [] })

  const dismissToast = (id: string) => {
    const timer = _timers.get(id)
    if (timer) {
      clearTimeout(timer)
      _timers.delete(id)
    }
    setState(
      produce((s) => {
        s.toasts = s.toasts.filter((t) => t.id !== id)
      }),
    )
  }

  const showToast = (type: ToastType, message: string, durationMs?: number) => {
    const duration = durationMs ?? DEFAULT_DURATION[type]
    const id = nextToastId()
    const newToast: Toast = { id, type, message, durationMs: duration }

    setState(
      produce((s) => {
        s.toasts.push(newToast)
        // Enforce max visible — dismiss oldest when exceeded
        while (s.toasts.length > MAX_VISIBLE) {
          const oldest = s.toasts[0]
          if (oldest) {
            const timer = _timers.get(oldest.id)
            if (timer) {
              clearTimeout(timer)
              _timers.delete(oldest.id)
            }
            s.toasts.splice(0, 1)
          }
        }
      }),
    )

    // Auto-dismiss after duration
    const timer = setTimeout(() => {
      _timers.delete(id)
      dismissToast(id)
    }, duration)
    _timers.set(id, timer)
  }

  const value: ToastContextValue = {
    get toasts() {
      return state.toasts
    },
    showToast,
    dismissToast,
  }

  // Wire up the module-level convenience object
  _showToastFn = showToast

  return (
    <ToastContext.Provider value={value}>
      {props.children}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error("useToast must be used within ToastProvider")
  return ctx
}

// ---------------------------------------------------------------------------
// Module-level convenience object (usable outside component tree)
// ---------------------------------------------------------------------------

let _showToastFn: ((type: ToastType, message: string, durationMs?: number) => void) | undefined

export const toast = {
  info(message: string, durationMs?: number) {
    _showToastFn?.("info", message, durationMs)
  },
  success(message: string, durationMs?: number) {
    _showToastFn?.("success", message, durationMs)
  },
  warn(message: string, durationMs?: number) {
    _showToastFn?.("warning", message, durationMs)
  },
  error(message: string, durationMs?: number) {
    _showToastFn?.("error", message, durationMs)
  },
}
