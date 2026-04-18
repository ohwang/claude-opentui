/**
 * Active Status Bar Preset — reactive signal + apply function.
 *
 * Unlike themes (which mutate an in-place colors store so every read site
 * re-subscribes), status bar presets swap whole components. We hold the
 * active preset id in a SolidJS signal and let the outer `StatusBar`
 * component subscribe to it. Changing it causes the component tree to swap.
 *
 * The registry is the source of truth for what presets exist;
 * `activeStatusBarId` / `applyStatusBar` are the runtime state that selects
 * one of them.
 */
import { createRoot, createSignal, type Accessor } from "solid-js"
import {
  DEFAULT_STATUS_BAR_ID,
  getStatusBar,
  resolveStatusBar,
} from "./registry"
import { log } from "../../../utils/logger"

const { active, setActive } = createRoot(() => {
  const [active, setActive] = createSignal<string>(DEFAULT_STATUS_BAR_ID)
  return { active, setActive }
})

/** Reactive accessor for the active preset id. Components subscribe here. */
export const activeStatusBarId: Accessor<string> = active

/** Get the current preset id synchronously (non-reactive). */
export function getCurrentStatusBarId(): string {
  return active()
}

/**
 * Set the active preset by id. Unknown ids soft-fail: the id is coerced to
 * `default`, a warning is logged, and the returned `{ fellBack: true }` lets
 * callers surface a UI message.
 */
export function applyStatusBar(
  id: string,
): { id: string; fellBack: boolean; requestedId?: string } {
  const { preset, fellBack, requestedId } = resolveStatusBar(id)
  if (fellBack) {
    log.warn("Unknown status bar preset id, falling back to default", {
      requested: requestedId,
      fallback: preset.id,
    })
  }
  setActive(preset.id)
  return { id: preset.id, fellBack, requestedId }
}

/**
 * Convenience: is the id a known preset? Uses the registry directly so
 * tests / callers don't have to import both modules.
 */
export function hasStatusBar(id: string): boolean {
  return getStatusBar(id) !== undefined
}
