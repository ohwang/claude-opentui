/**
 * Light Theme
 *
 * A clean light theme designed for bright terminal backgrounds. Every color
 * is chosen for readability against white/near-white surfaces — darker,
 * more saturated variants of the dark theme's palette.
 *
 * Design principles:
 *   - Text contrast: dark grays on white (WCAG AA minimum)
 *   - Surfaces: subtle warm grays that feel "elevated" without harshness
 *   - Status colors: saturated enough to read instantly on light backgrounds
 *   - Diff backgrounds: very light tinted washes, not dark blocks
 *   - Borders: visible but understated — no heavy outlines
 *
 * Color system based on Tailwind CSS color scale (600/700 for content on
 * light, 100/200 for backgrounds and tints).
 */

import type { ThemeDefinition } from "../types"

export const light: ThemeDefinition = {
  id: "light",
  name: "Light",
  colors: {
    text: {
      primary: "#1a1a2e",     // Near-black with a subtle cool shift — readable on white
      secondary: "#5c6370",   // Cool medium gray — metadata, tool args, file paths
      secondaryShimmer: "#4a5060", // Darker target for shimmer animations
      muted: "#9ca3af",       // Light gray — shortcut hints, connector glyphs, truncation
      inverse: "#ffffff",     // White — for inverted/reversed contexts
      thinking: "#8b8fa3",    // Cool-shifted gray — subdued but readable reasoning text
      briefLabel: "#2563eb",  // Blue-600 — context/brief labels
      briefLabelClaude: "#c2410c", // Orange-700 — Claude-specific labels
      // Deprecated aliases
      inactive: "#5c6370",
      inactiveShimmer: "#4a5060",
      subtle: "#d4d4d8",      // Zinc-300 — divider lines ONLY, never readable text
    },

    bg: {
      primary: "#ffffff",     // Pure white background
      surface: "#f4f4f5",     // Zinc-100 — user message bubbles, elevated surfaces
      surfaceHover: "#e4e4e7", // Zinc-200 — hover state
      overlay: "#eef0f6",     // Cool-shifted off-white — modals, diagnostics panels
      selection: "#bfdbfe",   // Blue-200 — text selection highlight (VS Code-like)
      bash: "#faf5ff",        // Violet-50 — subtle violet tint for bash context
      memory: "#eff6ff",      // Blue-50 — subtle blue tint for memory context
    },

    accent: {
      primary: "#c2410c",     // Orange-700 — warm brand, high contrast on white
      primaryShimmer: "#ea580c", // Orange-600 — shimmer target (brighter)
      logo: "#c2410c",        // Match primary — cat logo
      suggestion: "#6366f1",  // Indigo-500 — interactive suggestions, autocomplete
      suggestionShimmer: "#818cf8", // Indigo-400 — shimmer target
      permission: "#6366f1",  // Indigo — permission-related UI
      remember: "#6366f1",    // Indigo — remember action
      highlight: "#0891b2",   // Cyan-600 — selected items, focus highlights
      secondary: "#7c3aed",   // Violet-600 — secondary accent
      bash: "#be185d",        // Pink-700 — bash command prefix
      planMode: "#0d9488",    // Teal-600 — plan mode indicator
      ide: "#2563eb",         // Blue-600 — IDE mode indicator
      fastMode: "#c2410c",    // Orange-700 — fast mode (match primary)
      fastModeShimmer: "#ea580c", // Orange-600 — shimmer target
    },

    status: {
      success: "#16a34a",     // Green-600 — checkmarks, cost display, healthy state
      warning: "#ca8a04",     // Yellow-600 — amber gold, warm without feeling like error
      warningShimmer: "#eab308", // Yellow-500 — shimmer target
      error: "#dc2626",       // Red-600 — clear error signal, high contrast on white
      info: "#2563eb",        // Blue-600 — informational, calm but present
      infoShimmer: "#3b82f6", // Blue-500 — shimmer target
      merged: "#7c3aed",      // Violet-600 — merged state
    },

    border: {
      default: "#d4d4d8",     // Zinc-300 — structural borders, thinking block bars
      muted: "#e4e4e7",       // Zinc-200 — subtle dividers, scroll area borders
      error: "#dc2626",       // Red-600 — error borders
      permission: "#6366f1",  // Indigo-500 — permission dialog border
      elicitation: "#0891b2", // Cyan-600 — elicitation prompt border
      prompt: "#a1a1aa",      // Zinc-400 — input prompt border (idle)
      promptShimmer: "#71717a", // Zinc-500 — input prompt border (focused, darker)
      bash: "#be185d",        // Pink-700 — bash command border
    },

    state: {
      idle: "#16a34a",        // Green-600 — ready
      running: "#2563eb",     // Blue-600 — active processing
      waiting: "#ca8a04",     // Yellow-600 — awaiting user
      error: "#dc2626",       // Red-600 — problem state
      shuttingDown: "#a1a1aa", // Zinc-400 — terminating
    },

    permission: {
      allow: "#16a34a",       // Green-600 — approve
      alwaysAllow: "#6366f1", // Indigo-500 — permanent allow
      deny: "#ca8a04",        // Yellow-600 — deny (warning-level, not destructive)
      denySession: "#dc2626", // Red-600 — session deny (destructive)
      modeLabel: "#7c3aed",   // Violet-600 — permission mode label text
    },

    diff: {
      added: "#16a34a",       // Green-600 — added line text/sign
      removed: "#dc2626",     // Red-600 — removed line text/sign
      addedBg: "#dcfce7",     // Green-100 — very light green wash for added lines
      removedBg: "#fee2e2",   // Red-100 — very light red wash for removed lines
      addedDimmed: "#bbf7d0", // Green-200 — slightly stronger green tint
      removedDimmed: "#fecaca", // Red-200 — slightly stronger red tint
    },

    rateLimit: {
      fill: "#6366f1",        // Indigo-500 — filled portion of rate limit bar
      empty: "#e4e4e7",       // Zinc-200 — empty portion (subtle on white)
    },

    agents: {
      red: "#dc2626",         // Red-600
      blue: "#2563eb",        // Blue-600
      green: "#16a34a",       // Green-600
      yellow: "#ca8a04",      // Yellow-600
      purple: "#7c3aed",      // Violet-600
      orange: "#ea580c",      // Orange-600
      pink: "#db2777",        // Pink-600
      cyan: "#0891b2",        // Cyan-600
    },
  },
}
