/**
 * Custom SyntaxStyle for markdown rendering
 *
 * Provides colored headings, bold, italic, links, code blocks
 * instead of the default (potentially uncolored) theme.
 *
 * Uses SyntaxStyle.fromTheme() which accepts ColorInput (hex strings)
 * via ThemeTokenStyle, avoiding manual RGBA.fromHex() conversions.
 */

import { SyntaxStyle } from "@opentui/core"
import { colors } from "./tokens"

export const syntaxStyle = SyntaxStyle.fromTheme([
  // Default text
  {
    scope: ["default"],
    style: { foreground: colors.text.primary },
  },
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
])
