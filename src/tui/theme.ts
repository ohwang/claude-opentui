/**
 * Theme -- re-exports from the centralized design system
 *
 * Preserves backward compatibility for existing imports while
 * delegating to the new token/syntax modules.
 *
 * Usage guidance, anti-patterns, and the text hierarchy docs
 * live in ./theme/tokens.ts — read that file before adding
 * or changing any colors.
 */

export { syntaxStyle } from "./theme/syntax"
export { colors } from "./theme/tokens"
