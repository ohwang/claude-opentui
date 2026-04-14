/**
 * Theme -- re-exports from the centralized design system
 *
 * Preserves backward compatibility for existing imports while
 * delegating to the token/syntax/registry modules.
 *
 * Usage guidance, anti-patterns, and the text hierarchy docs
 * live in ./theme/tokens.ts — read that file before adding
 * or changing any colors.
 */

export { getSyntaxStyle } from "./theme/syntax"
export { colors, applyTheme, getCurrentThemeId } from "./theme/tokens"
export { registerTheme, getTheme, listThemes } from "./theme/registry"
export type { ThemeDefinition, ThemeColors } from "./theme/types"
