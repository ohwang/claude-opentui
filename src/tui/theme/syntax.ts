/**
 * Custom SyntaxStyle for markdown + code rendering
 *
 * Provides colored headings, bold, italic, links, code blocks
 * AND syntax-highlighted code (keywords, strings, comments, etc.)
 * for the <code> component used in show_all tool output.
 *
 * Uses SyntaxStyle.fromTheme() which accepts ColorInput (hex strings)
 * via ThemeTokenStyle, avoiding manual RGBA.fromHex() conversions.
 *
 * Tree-sitter capture names follow the standard Neovim/Helix convention:
 *   keyword, string, comment, function, variable, type, number, etc.
 *
 * ── Two-tier color system ──────────────────────────────────────────
 *
 * Markdown scopes (headings, bold, links) reference tokens from
 * ./tokens.ts so they stay in sync with the rest of the UI.
 *
 * Code syntax scopes use hardcoded hex values from a cohesive editor
 * palette (Material-inspired). This is intentional — code highlighting
 * colors serve readability inside fenced blocks and are a separate
 * concern from the application's UI chrome colors. If we later support
 * user-selectable editor themes, these would move to a dedicated
 * palette, not into tokens.ts.
 */

import { SyntaxStyle } from "@opentui/core"
import { colors } from "./tokens"

export const syntaxStyle = SyntaxStyle.fromTheme([
  // ─── Default text ───────────────────────────────────────────────────
  {
    scope: ["default"],
    style: { foreground: colors.text.primary },
  },

  // ─── Markdown scopes ───────────────────────────────────────────────
  // Headings -- bold accent color
  {
    scope: ["markup.heading"],
    style: { foreground: colors.accent.primary, bold: true },
  },
  // Bold -- white with bold attribute
  {
    scope: ["markup.strong"],
    style: { foreground: colors.text.white, bold: true },
  },
  // Italic -- secondary with italic
  {
    scope: ["markup.italic"],
    style: { foreground: colors.text.secondary, italic: true },
  },
  // Inline code
  {
    scope: ["markup.raw"],
    style: { foreground: colors.status.info },
  },
  // Links
  {
    scope: ["markup.link"],
    style: { foreground: colors.text.link, underline: true },
  },
  {
    scope: ["markup.link.label"],
    style: { foreground: colors.text.link },
  },
  {
    scope: ["markup.link.url"],
    style: { foreground: colors.text.muted, underline: true },
  },
  // Strikethrough
  {
    scope: ["markup.strikethrough"],
    style: { foreground: colors.text.muted, dim: true },
  },
  // Table borders / conceal markers
  {
    scope: ["conceal"],
    style: { foreground: colors.text.muted },
  },

  // ─── Code scopes (tree-sitter highlights) ──────────────────────────
  // Keywords: import, export, const, let, if, return, function, etc.
  {
    scope: ["keyword"],
    style: { foreground: "#c792ea" },  // soft purple
  },
  {
    scope: ["keyword.return", "keyword.operator"],
    style: { foreground: "#c792ea" },
  },
  // Strings: "hello", 'world', `template`
  {
    scope: ["string"],
    style: { foreground: "#c3e88d" },  // muted green
  },
  {
    scope: ["string.special"],
    style: { foreground: "#89ddff" },  // cyan for template expressions
  },
  // Comments
  {
    scope: ["comment"],
    style: { foreground: "#676e95", italic: true },  // dim blue-gray
  },
  // Functions / method calls
  {
    scope: ["function", "function.call", "function.method"],
    style: { foreground: "#82aaff" },  // soft blue
  },
  // Variables and parameters
  {
    scope: ["variable"],
    style: { foreground: colors.text.primary },
  },
  {
    scope: ["variable.builtin", "variable.parameter"],
    style: { foreground: "#f78c6c" },  // warm orange
  },
  // Types and type annotations
  {
    scope: ["type", "type.builtin"],
    style: { foreground: "#ffcb6b" },  // warm yellow
  },
  // Numbers and booleans
  {
    scope: ["number", "constant.numeric", "boolean"],
    style: { foreground: "#f78c6c" },  // warm orange
  },
  // Constants (UPPER_CASE, true, false, null)
  {
    scope: ["constant", "constant.builtin"],
    style: { foreground: "#f78c6c" },
  },
  // Operators: =, +, -, *, /, =>, etc.
  {
    scope: ["operator"],
    style: { foreground: "#89ddff" },  // cyan
  },
  // Punctuation: (), {}, [], ., ,, ;
  {
    scope: ["punctuation", "punctuation.bracket", "punctuation.delimiter"],
    style: { foreground: colors.text.secondary },
  },
  // Properties / object keys
  {
    scope: ["property"],
    style: { foreground: "#f07178" },  // soft red
  },
  // JSX/TSX tags
  {
    scope: ["tag"],
    style: { foreground: "#f07178" },  // soft red (matching property)
  },
  {
    scope: ["tag.attribute"],
    style: { foreground: "#c792ea" },  // purple for attributes
  },
  // Labels / decorators
  {
    scope: ["label"],
    style: { foreground: "#c792ea" },
  },
  // Escape sequences (\n, \t, etc.)
  {
    scope: ["escape"],
    style: { foreground: "#89ddff" },
  },
  // Constructor calls (new Foo())
  {
    scope: ["constructor"],
    style: { foreground: "#ffcb6b" },
  },
])
