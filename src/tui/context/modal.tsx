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

export type ModalComponent = () => JSX.Element

export interface ModalContextValue {
  content: () => ModalComponent | null
  show: (component: ModalComponent) => void
  dismiss: () => void
  isActive: () => boolean
}

const ModalContext = createContext<ModalContextValue>()

export function ModalProvider(props: ParentProps) {
  const [content, setContent] = createSignal<ModalComponent | null>(null)

  const value: ModalContextValue = {
    content,
    show: (c) => setContent(() => c),
    dismiss: () => setContent(null),
    isActive: () => content() !== null,
  }

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
