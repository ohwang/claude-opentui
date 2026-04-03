/**
 * Modal Context — manages overlay dialogs for rich command UIs.
 *
 * Commands call showModal(component) to render a full-screen overlay
 * that replaces the conversation view. Escape dismisses.
 *
 * Stores a component FUNCTION (not pre-rendered JSX) so SolidJS
 * creates the reactive tree inside its own tracking context.
 */

import {
  createContext,
  useContext,
  type ParentProps,
  type JSX,
} from "solid-js"
import { createSignal } from "solid-js"
import type { KeyEvent } from "@opentui/core"

export type ModalComponent = () => JSX.Element

/** Key handler that modal content can register to receive keyboard events.
 *  Return true if the event was handled, false to fall through to default modal handling. */
export type ModalKeyHandler = (event: KeyEvent) => boolean

export interface ModalContextValue {
  content: () => ModalComponent | null
  show: (component: ModalComponent) => void
  dismiss: () => void
  isActive: () => boolean
  /** Current modal key handler (set by modal content, cleared on dismiss) */
  keyHandler: () => ModalKeyHandler | null
}

const ModalContext = createContext<ModalContextValue>()

export function ModalProvider(props: ParentProps) {
  const [content, setContent] = createSignal<ModalComponent | null>(null)
  const [keyHandler, setKeyHandler] = createSignal<ModalKeyHandler | null>(null)

  const value: ModalContextValue = {
    content,
    show: (c) => setContent(() => c),
    dismiss: () => {
      setContent(null)
      setKeyHandler(null)
    },
    isActive: () => content() !== null,
    keyHandler,
  }

  // Expose the setter via module-level function so modal content can register handlers
  _setKeyHandler = (handler: ModalKeyHandler | null) => setKeyHandler(() => handler)

  return (
    <ModalContext.Provider value={value}>
      {props.children}
    </ModalContext.Provider>
  )
}

export function useModal(): ModalContextValue {
  const ctx = useContext(ModalContext)
  if (!ctx) throw new Error("useModal must be used within ModalProvider")
  return ctx
}

// Module-level accessors for use outside component tree (e.g., slash commands)
let _modal: ModalContextValue | undefined

export function registerModalRef(modal: ModalContextValue): void {
  _modal = modal
}

export function showModal(component: ModalComponent): void {
  _modal?.show(component)
}

export function dismissModal(): void {
  _modal?.dismiss()
}

/**
 * Module-level function to set/clear the modal key handler.
 * Called by modal content components (e.g. HistorySearchModal) to register
 * their key handler without needing the ModalContext directly.
 */
let _setKeyHandler: ((handler: ModalKeyHandler | null) => void) | undefined

export function setModalKeyHandler(handler: ModalKeyHandler | null): void {
  _setKeyHandler?.(handler)
}
