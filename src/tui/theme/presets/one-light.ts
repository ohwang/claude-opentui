/**
 * One Light Theme
 *
 * Based on Atom's iconic One Light palette — a warm, low-contrast light
 * theme designed for long coding sessions. Uses the original One Light
 * hue set (hue-1..hue-6) for accents and syntax, with the classic
 * "mono-1..mono-3" grays for text hierarchy.
 *
 * Design principles:
 *   - Text: mono-1 (#383a42) on near-white (#fafafa) — WCAG AAA contrast
 *   - Secondary/metadata: mono-2 (#696c77) — still clearly readable
 *   - Muted/decoration: mono-3 (#a0a1a7) — visible on white, non-competing
 *   - Accents: the canonical One Light hues — purple/red/green/blue/gold
 *   - Diff tints: very light washes (hue-4/hue-5 at low saturation)
 *   - Borders: soft cool gray (#d4d4d6) — visible but understated
 *
 * Reference palette (Atom One Light v1.0):
 *   mono-1  #383a42   main text
 *   mono-2  #696c77   secondary text, comments
 *   mono-3  #a0a1a7   disabled / muted
 *   hue-1   #0184bc   cyan  — operators, escape
 *   hue-2   #4078f2   blue  — functions, links
 *   hue-3   #a626a4   purple — keywords
 *   hue-4   #50a14f   green — strings, success
 *   hue-5   #e45649   red   — variables, errors (soft)
 *   hue-5-2 #ca1243   darker red — pure errors
 *   hue-6   #986801   amber — numbers, constants
 *   hue-6-2 #c18401   gold  — types
 *   syntax-bg  #fafafa
 */

import type { ThemeDefinition } from "../types"

export const oneLight: ThemeDefinition = {
  id: "one-light",
  name: "One Light",
  colors: {
    text: {
      primary: "#383a42",         // mono-1 — primary body text, WCAG AAA on #fafafa
      secondary: "#4f525c",       // Slightly darker than mono-2 for better legibility
      secondaryShimmer: "#383a42", // fade toward primary
      muted: "#696c77",           // mono-2 — readable hints on white (AA compliant)
      inverse: "#fafafa",         // syntax-bg — for inverted contexts
      thinking: "#5c5f68",        // Dark enough to read, still clearly "secondary"
      briefLabel: "#2c5fd3",      // Darker hue-2 blue — context/brief labels, meets AA
      briefLabelClaude: "#a35900", // Darker warm amber — Claude-specific label, meets AA
      cursor: "#383a42",          // Matches primary — dark cursor block on white
      // Deprecated aliases
      inactive: "#4f525c",
      inactiveShimmer: "#383a42",
      subtle: "#c8c9cc",          // Divider lines ONLY — visible on light bg
    },

    bg: {
      primary: "#fafafa",         // syntax-bg — the canonical One Light background
      surface: "#eaeaeb",         // Elevated surfaces — user bubbles, inputs
      surfaceHover: "#dddde0",    // Hover state — clearly distinct
      overlay: "#f0f0f1",         // Modal/diagnostics — subtle lift above bg
      selection: "#cde0fc",       // Light blue selection, WCAG text-readable over it
      bash: "#f6ecf7",            // Very light purple-pink tint for bash context
      memory: "#ebf2fd",          // Very light blue tint for memory context
    },

    accent: {
      primary: "#a35900",         // Warm amber — brand accent, high contrast on white
      primaryShimmer: "#c26b02",  // Brighter amber — shimmer target
      logo: "#a35900",            // Match primary
      suggestion: "#2c5fd3",      // Darker hue-2 blue — autocomplete, meets AA on white
      suggestionShimmer: "#4078f2", // Lightened to canonical hue-2 for shimmer
      permission: "#a626a4",      // hue-3 purple — permission UI
      remember: "#a626a4",        // hue-3 purple — remember action
      highlight: "#016a96",       // Darker hue-1 cyan — focus, meets AA on white
      secondary: "#a626a4",       // hue-3 purple — secondary accent
      bash: "#ca1243",            // hue-5-2 red — bash command prefix
      planMode: "#016a96",        // Darker hue-1 cyan — plan mode
      ide: "#2c5fd3",             // Darker hue-2 blue — IDE mode, meets AA on white
      fastMode: "#a35900",        // amber — match primary
      fastModeShimmer: "#c26b02", // brighter amber shimmer
    },

    status: {
      success: "#1b7a32",         // Darker green — meets AA, still reads as "One Light green"
      warning: "#8a5f00",         // Darker gold — meets AA on white
      warningShimmer: "#c18401",  // hue-6-2 gold — shimmer target (brighter)
      error: "#ca1243",           // hue-5-2 — strong red, high contrast on white
      info: "#2c5fd3",            // Darker hue-2 blue — informational, meets AA
      infoShimmer: "#4078f2",     // hue-2 blue — shimmer target
      merged: "#a626a4",          // hue-3 purple — merged state
    },

    border: {
      default: "#a0a1a7",         // mono-3 — structural borders
      muted: "#d4d4d6",           // Very subtle but visible dividers
      error: "#ca1243",           // hue-5-2 red
      permission: "#a626a4",      // hue-3 purple
      elicitation: "#0184bc",     // hue-1 cyan
      prompt: "#a0a1a7",          // mono-3 — input border idle
      promptShimmer: "#696c77",   // mono-2 — input border focused
      bash: "#ca1243",            // hue-5-2 red
    },

    state: {
      idle: "#50a14f",            // hue-4 green — ready
      running: "#4078f2",         // hue-2 blue — active
      waiting: "#c18401",         // hue-6-2 gold — awaiting user
      error: "#ca1243",           // hue-5-2 red — problem
      shuttingDown: "#a0a1a7",    // mono-3 — terminating
    },

    permission: {
      allow: "#50a14f",           // hue-4 green — approve
      alwaysAllow: "#a626a4",     // hue-3 purple — permanent allow
      deny: "#c18401",            // hue-6-2 gold — deny (warning)
      denySession: "#ca1243",     // hue-5-2 red — destructive deny
      modeLabel: "#a626a4",       // hue-3 purple — mode label
    },

    diff: {
      added: "#3d8b3c",           // Slightly darker than hue-4 for readability on green bg
      removed: "#ca1243",         // hue-5-2 red — removed text
      addedBg: "#e0f4e0",         // Very light green wash
      removedBg: "#fbe3e3",       // Very light red wash
      addedDimmed: "#c6e9c5",     // Slightly stronger green tint
      removedDimmed: "#f5cfcf",   // Slightly stronger red tint
    },

    rateLimit: {
      fill: "#4078f2",            // hue-2 blue — filled portion
      empty: "#d4d4d6",           // Match border.muted — empty portion
    },

    agents: {
      red: "#ca1243",             // hue-5-2
      blue: "#4078f2",            // hue-2
      green: "#50a14f",           // hue-4
      yellow: "#c18401",          // hue-6-2
      purple: "#a626a4",          // hue-3
      orange: "#a35900",          // amber
      pink: "#d33682",            // magenta
      cyan: "#0184bc",            // hue-1
    },
  },
}
