/**
 * Theme — shared style constants for the TUI
 *
 * Provides a singleton SyntaxStyle instance used by all markdown
 * and code components. Created once at import time.
 */

import { SyntaxStyle } from "@opentui/core"

/**
 * Shared SyntaxStyle for markdown and code rendering.
 *
 * SyntaxStyle.create() returns a default style with standard
 * syntax-highlighting colors. One instance is shared across
 * all <markdown> and <code> elements.
 */
export const syntaxStyle = SyntaxStyle.create()
