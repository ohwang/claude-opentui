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
 * Code syntax scopes use two palettes — one for dark backgrounds
 * (Material-inspired) and one for light backgrounds (One Light-
 * inspired). The active palette is chosen automatically based on
 * the theme's bg.primary luminance.
 *
 * ── Reactivity ────────────────────────────────────────────────────
 *
 * syntaxStyle is rebuilt on every theme change. Because SyntaxStyle
 * is a Zig-side object (not a SolidJS store), we expose it via a
 * getter function — `getSyntaxStyle()` — backed by a version signal.
 * Components must call `getSyntaxStyle()` in JSX so SolidJS tracks
 * the dependency and re-evaluates on theme switch.
 */

import { createSignal } from "solid-js"
import { SyntaxStyle } from "@opentui/core"
import { colors, _registerSyntaxRebuilder } from "./tokens"

// ---------------------------------------------------------------------------
// Light vs dark detection
// ---------------------------------------------------------------------------

function isLightBackground(): boolean {
  const bg = colors.bg.primary
  if (!bg) return false
  const hex = bg.replace("#", "")
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  // Relative luminance approximation (BT.601)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5
}

// ---------------------------------------------------------------------------
// Code syntax palettes
// ---------------------------------------------------------------------------

/** Material-inspired palette for dark backgrounds. */
const DARK_SYNTAX = {
  keyword: "#c792ea",     // soft purple
  string: "#c3e88d",      // muted green
  stringSpecial: "#89ddff", // cyan
  comment: "#676e95",     // dim blue-gray
  function: "#82aaff",    // soft blue
  variableBuiltin: "#f78c6c", // warm orange
  type: "#ffcb6b",        // warm yellow
  number: "#f78c6c",      // warm orange
  operator: "#89ddff",    // cyan
  property: "#f07178",    // soft red
  tag: "#f07178",         // soft red
  tagAttribute: "#c792ea", // purple
  escape: "#89ddff",      // cyan
  constructor: "#ffcb6b", // warm yellow
}

/** One Light-inspired palette for light backgrounds. */
const LIGHT_SYNTAX = {
  keyword: "#a626a4",     // purple
  string: "#50a14f",      // green
  stringSpecial: "#4078f2", // blue
  comment: "#a0a1a7",     // gray
  function: "#4078f2",    // blue
  variableBuiltin: "#e45649", // red
  type: "#c18401",        // dark gold
  number: "#986801",      // brown/amber
  operator: "#0184bc",    // cyan-blue
  property: "#e45649",    // red
  tag: "#e45649",         // red
  tagAttribute: "#c18401", // dark gold
  escape: "#0184bc",      // cyan-blue
  constructor: "#c18401", // dark gold
}

// ---------------------------------------------------------------------------
// SyntaxStyle builder
// ---------------------------------------------------------------------------

function buildSyntaxStyle(): SyntaxStyle {
  const syn = isLightBackground() ? LIGHT_SYNTAX : DARK_SYNTAX

  return SyntaxStyle.fromTheme([
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
    // Bold -- primary with bold attribute
    {
      scope: ["markup.strong"],
      style: { foreground: colors.text.primary, bold: true },
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
      style: { foreground: colors.text.briefLabel, underline: true },
    },
    {
      scope: ["markup.link.label"],
      style: { foreground: colors.text.briefLabel },
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
      style: { foreground: colors.text.subtle },
    },

    // ─── Code scopes (tree-sitter highlights) ──────────────────────────
    {
      scope: ["keyword"],
      style: { foreground: syn.keyword },
    },
    {
      scope: ["keyword.return", "keyword.operator"],
      style: { foreground: syn.keyword },
    },
    {
      scope: ["string"],
      style: { foreground: syn.string },
    },
    {
      scope: ["string.special"],
      style: { foreground: syn.stringSpecial },
    },
    {
      scope: ["comment"],
      style: { foreground: syn.comment, italic: true },
    },
    {
      scope: ["function", "function.call", "function.method"],
      style: { foreground: syn.function },
    },
    {
      scope: ["variable"],
      style: { foreground: colors.text.primary },
    },
    {
      scope: ["variable.builtin", "variable.parameter"],
      style: { foreground: syn.variableBuiltin },
    },
    {
      scope: ["type", "type.builtin"],
      style: { foreground: syn.type },
    },
    {
      scope: ["number", "constant.numeric", "boolean"],
      style: { foreground: syn.number },
    },
    {
      scope: ["constant", "constant.builtin"],
      style: { foreground: syn.number },
    },
    {
      scope: ["operator"],
      style: { foreground: syn.operator },
    },
    {
      scope: ["punctuation", "punctuation.bracket", "punctuation.delimiter"],
      style: { foreground: colors.text.secondary },
    },
    {
      scope: ["property"],
      style: { foreground: syn.property },
    },
    {
      scope: ["tag"],
      style: { foreground: syn.tag },
    },
    {
      scope: ["tag.attribute"],
      style: { foreground: syn.tagAttribute },
    },
    {
      scope: ["label"],
      style: { foreground: syn.keyword },
    },
    {
      scope: ["escape"],
      style: { foreground: syn.escape },
    },
    {
      scope: ["constructor"],
      style: { foreground: syn.constructor },
    },
  ])
}

// ---------------------------------------------------------------------------
// Reactive export — version signal drives re-evaluation
// ---------------------------------------------------------------------------

const [syntaxVersion, setSyntaxVersion] = createSignal(0)
let currentSyntaxStyle = buildSyntaxStyle()

/**
 * Get the current SyntaxStyle. Call this inside JSX props so SolidJS
 * tracks the dependency and re-evaluates when the theme changes.
 *
 *   <markdown syntaxStyle={getSyntaxStyle()} />
 */
export function getSyntaxStyle(): SyntaxStyle {
  syntaxVersion() // subscribe to version changes
  return currentSyntaxStyle
}

// Backward-compat: the old `syntaxStyle` variable export is gone.
// All consumers must use `getSyntaxStyle()`.

/** Rebuild syntax style from current colors. Called by applyTheme(). */
export function rebuildSyntaxStyle(): void {
  currentSyntaxStyle = buildSyntaxStyle()
  setSyntaxVersion(v => v + 1)
}

// Register the rebuilder so applyTheme() can call it without circular imports
_registerSyntaxRebuilder(rebuildSyntaxStyle)
