/**
 * Design System -- Semantic Color Tokens
 *
 * Single source of truth for all colors in the TUI.
 * Derived from the active theme (default: Dark).
 * Import from here instead of hardcoding hex values.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * TOKEN NAMING — intent over appearance
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Tokens are named after WHAT THEY MEAN, not what they look like.
 * This matches Claude Code's flat semantic vocabulary and ensures the
 * name stays correct even if the hex value changes for a theme variant.
 *
 *   ✓  colors.text.secondary    (describes intent: "readable metadata")
 *   ✗  colors.text.gray         (describes appearance)
 *   ✗  colors.accent.periwinkle (describes color)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * TEXT HIERARCHY — choosing the right gray
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   text.primary     #ffffff   Main content: assistant responses, user input,
 *                              tool names, anything the user *reads*.
 *
 *   text.secondary   #b0b0b0   Readable metadata: version strings, model info,
 *                              timestamps, file paths, cost, token counts,
 *                              tool arguments, conversation tips. Clearly
 *                              legible — just less prominent than primary.
 *
 *   text.muted       #777777   Low-priority hints: shortcut labels, connector
 *                              glyphs, truncation indicators, dim result
 *                              summaries, ephemeral status text. Visible but
 *                              not competing for attention.
 *
 *                              ⚠️  NEVER combine text.muted with DIM.
 *                              The token is already at the target brightness.
 *
 *   text.thinking    #808080   Thinking blocks: subdued but readable gray
 *                              for Claude's reasoning text.
 *
 *   text.subtle      #505050   NON-TEXT decoration ONLY: <Divider> lines.
 *                              NEVER use on <text>, <markdown>, or readable
 *                              elements.
 *
 *   ⚠️  DEPRECATED ALIASES:
 *       text.inactive       → use text.secondary
 *       text.inactiveShimmer → use text.secondaryShimmer
 *       These aliases exist for backward compatibility and will be
 *       removed in a future release.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * BACKGROUND TOKENS — when to use what
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   bg.primary     #000000   Base terminal background. Rarely set explicitly
 *                            — the terminal's own bg is inherited.
 *
 *   bg.surface     #373737   Elevated surface: user message bubbles, input
 *                            areas. Provides a subtle lift against the
 *                            terminal default.
 *
 *   bg.overlay     #2c323e   Popovers, modals, diagnostics panels.
 *                            Cool-shifted gray to feel "above" surface.
 *
 *   bg.selection   #264f78   Text selection highlight. Classic VS Code blue.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * STATUS vs STATE — similar but different
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   status.*   Semantic meanings (success/warning/error/info) for any
 *              context: toast notifications, inline badges, cost display.
 *
 *   state.*    Agent lifecycle states (idle/running/waiting/error) for
 *              the status bar indicator dot. Each maps to a status color
 *              but with its own token so they can diverge later.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * SHIMMER VARIANTS — animation lighter colors
 * ═══════════════════════════════════════════════════════════════════════
 *
 * For every animated color, a lighter `*Shimmer` variant is available.
 * These are used for fade-in effects, hover glows, and pulse animations
 * instead of computing lighter values at runtime.
 *
 *   accent.primaryShimmer       lighter claude orange for shimmer effect
 *   accent.suggestionShimmer    lighter suggestion blue for hover/pulse
 *   accent.fastModeShimmer      lighter fast mode orange for shimmer
 *   text.secondaryShimmer       lighter secondary gray for fade-in
 *   status.warningShimmer       lighter warning amber for pulse
 *   status.infoShimmer          lighter info blue for pulse
 *   border.promptShimmer        lighter prompt border for focus effect
 *
 * Pattern: lerp FROM base TO shimmer (or vice versa) in animations.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * THEMING
 * ═══════════════════════════════════════════════════════════════════════
 *
 * `colors` is a SolidJS store proxy derived from the active ThemeDefinition.
 * Reading any token (e.g. `colors.text.primary`) inside a reactive context
 * (JSX, createMemo, createEffect) subscribes to that token. When applyTheme()
 * updates the store, only the affected components re-render.
 *
 * ⚠️  NEVER snapshot a color into a local constant:
 *       const ACCENT = colors.border.permission  // BUG: won't update
 *     Always read inline in JSX or via a () => accessor.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * GENERAL RULES
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   1. Never hardcode hex values in components. Import from this file.
 *   2. Use hex strings, not ANSI numbers — `fg="#ff6b80"` not `fg={255}`.
 *      ANSI numbers crash the Zig FFI.
 *   3. Use `fg=` on <text>, `backgroundColor=` on <box>. The `bg=` prop
 *      only works on <text> elements; on <box> it is silently ignored.
 *   4. Prefer semantic tokens (status.error) over raw palette tokens
 *      (agents.red) unless you genuinely need the agent palette.
 *   5. When adding a new color, check if an existing token already
 *      covers the use case before creating a new one.
 *   6. Never combine text.muted with TextAttributes.DIM — the token
 *      is already at its intended brightness.
 */

import { createRoot } from "solid-js"
import { createStore, reconcile, type SetStoreFunction } from "solid-js/store"
import type { ThemeColors, ThemeDefinition } from "./types"
import { defaultDark } from "./presets/default-dark"

// ---------------------------------------------------------------------------
// Active theme state (SolidJS store for reactive theme switching)
// ---------------------------------------------------------------------------

let currentThemeId = defaultDark.id
let setColors: SetStoreFunction<ThemeColors>

/**
 * The active color tokens — a SolidJS store proxy.
 *
 * Reading `colors.text.primary` inside a reactive context (JSX, createMemo,
 * createEffect) automatically subscribes to that specific token. When a theme
 * switch updates that token, only the subscribing components re-render.
 *
 * Components import this directly:
 *   import { colors } from "../theme/tokens"
 *   <text fg={colors.text.primary}>
 *
 * ⚠️  NEVER snapshot a color into a module-level constant:
 *       const ACCENT = colors.border.permission  // BUG: won't update on theme switch
 *     Instead, read colors inline in JSX or via () => accessor.
 */
export const colors: ThemeColors = createRoot(() => {
  const [state, setState] = createStore<ThemeColors>(
    structuredClone(defaultDark.colors) as ThemeColors,
  )
  setColors = setState
  return state
}) as ThemeColors

// ---------------------------------------------------------------------------
// Theme switching
// ---------------------------------------------------------------------------

/**
 * Apply a theme by updating the reactive store.
 * All components reading color tokens will automatically re-render.
 */
export function applyTheme(theme: ThemeDefinition): void {
  currentThemeId = theme.id
  setColors(reconcile(structuredClone(theme.colors) as ThemeColors))
  // Rebuild syntax highlighting with new colors (non-reactive Zig-side object)
  rebuildSyntax()
}

/** Get the ID of the currently active theme. */
export function getCurrentThemeId(): string {
  return currentThemeId
}

// Lazy import to avoid circular dependency (syntax.ts imports from tokens.ts)
let rebuildSyntax = () => {}
export function _registerSyntaxRebuilder(fn: () => void): void {
  rebuildSyntax = fn
}

// Convenience alias
export type HexColor = string
