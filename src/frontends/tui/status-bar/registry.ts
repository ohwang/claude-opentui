/**
 * Status Bar Preset Registry — stores and retrieves native status bar presets.
 *
 * Parallel to `src/tui/theme/registry.ts`. Pre-registers built-in presets.
 * External presets (community, user-defined) can be registered at startup
 * before render() is called.
 */

import type { StatusBarPreset } from "./types"
import { defaultPreset } from "./presets/default"
import { minimalPreset } from "./presets/minimal"
import { detailedPreset } from "./presets/detailed"
import { claudeCompatPreset } from "./presets/claude-compat"

const presets = new Map<string, StatusBarPreset>()

// Register built-in presets
presets.set(defaultPreset.id, defaultPreset)
presets.set(minimalPreset.id, minimalPreset)
presets.set(detailedPreset.id, detailedPreset)
presets.set(claudeCompatPreset.id, claudeCompatPreset)

/** The id guaranteed to always exist — the fallback for unknown ids. */
export const DEFAULT_STATUS_BAR_ID = claudeCompatPreset.id

/** Register a status bar preset. Overwrites if the id already exists. */
export function registerStatusBar(preset: StatusBarPreset): void {
  presets.set(preset.id, preset)
}

/** Look up a preset by id. */
export function getStatusBar(id: string): StatusBarPreset | undefined {
  return presets.get(id)
}

/** List all registered presets. */
export function listStatusBars(): StatusBarPreset[] {
  return [...presets.values()]
}

/**
 * Resolve a preset by id, soft-falling back to `default` when unknown.
 * Returns both the resolved preset and whether a fallback occurred, so
 * callers can warn the user.
 */
export function resolveStatusBar(
  id: string | undefined,
): { preset: StatusBarPreset; fellBack: boolean; requestedId?: string } {
  if (!id) {
    return { preset: presets.get(DEFAULT_STATUS_BAR_ID)!, fellBack: false }
  }
  const hit = presets.get(id)
  if (hit) return { preset: hit, fellBack: false }
  return {
    preset: presets.get(DEFAULT_STATUS_BAR_ID)!,
    fellBack: true,
    requestedId: id,
  }
}
