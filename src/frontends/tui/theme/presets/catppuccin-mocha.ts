/**
 * Catppuccin Mocha Theme
 *
 * The most popular community dark theme. Warm, pastel colors on a deep
 * blue-tinted base. Uses the official Catppuccin Mocha palette.
 *
 * @see https://github.com/catppuccin/catppuccin
 */

import type { ThemeDefinition } from "../types"

export const catppuccinMocha: ThemeDefinition = {
  id: "catppuccin-mocha",
  name: "Catppuccin Mocha",
  colors: {
    text: {
      primary: "#cdd6f4", // Text
      secondary: "#bac2de", // Subtext1
      secondaryShimmer: "#cdd6f4", // Text (brighter on shimmer)
      muted: "#6c7086", // Overlay0
      inverse: "#1e1e2e", // Base
      thinking: "#a6adc8", // Subtext0
      briefLabel: "#89b4fa", // Blue
      briefLabelClaude: "#fab387", // Peach
      // Deprecated aliases
      inactive: "#bac2de", // Subtext1
      inactiveShimmer: "#cdd6f4", // Text
      subtle: "#45475a", // Surface1
    },

    bg: {
      primary: "#1e1e2e", // Base
      surface: "#313244", // Surface0
      surfaceHover: "#45475a", // Surface1
      overlay: "#181825", // Mantle
      selection: "#585b70", // Surface2
      bash: "#302838", // Muted mauve tint
      memory: "#273040", // Muted blue tint
    },

    accent: {
      primary: "#fab387", // Peach — warm brand color
      primaryShimmer: "#f5e0dc", // Rosewater
      logo: "#fab387", // Peach
      suggestion: "#b4befe", // Lavender — interactive
      suggestionShimmer: "#cdd6f4", // Text (bright shimmer)
      permission: "#b4befe", // Lavender
      remember: "#b4befe", // Lavender
      highlight: "#94e2d5", // Teal
      secondary: "#cba6f7", // Mauve
      bash: "#f5c2e7", // Pink
      planMode: "#94e2d5", // Teal
      ide: "#89b4fa", // Blue
      fastMode: "#fab387", // Peach
      fastModeShimmer: "#f5e0dc", // Rosewater
    },

    status: {
      success: "#a6e3a1", // Green
      warning: "#f9e2af", // Yellow
      warningShimmer: "#f5e0dc", // Rosewater
      error: "#f38ba8", // Red
      info: "#89b4fa", // Blue
      infoShimmer: "#b4befe", // Lavender
      merged: "#cba6f7", // Mauve
    },

    border: {
      default: "#45475a", // Surface1
      muted: "#313244", // Surface0
      error: "#f38ba8", // Red
      permission: "#b4befe", // Lavender
      elicitation: "#94e2d5", // Teal
      prompt: "#6c7086", // Overlay0
      promptShimmer: "#a6adc8", // Subtext0
      bash: "#f5c2e7", // Pink
    },

    state: {
      idle: "#a6e3a1", // Green
      running: "#89b4fa", // Blue
      waiting: "#f9e2af", // Yellow
      error: "#f38ba8", // Red
      shuttingDown: "#a6adc8", // Subtext0
    },

    permission: {
      allow: "#a6e3a1", // Green
      alwaysAllow: "#b4befe", // Lavender
      deny: "#f9e2af", // Yellow
      denySession: "#f38ba8", // Red
      modeLabel: "#cba6f7", // Mauve
    },

    diff: {
      added: "#a6e3a1", // Green
      removed: "#f38ba8", // Red
      addedBg: "#2a4030", // Darkened green
      removedBg: "#4a2535", // Darkened red
      addedDimmed: "#3a4a3e", // Muted green tint
      removedDimmed: "#4a3a40", // Muted red tint
    },

    rateLimit: {
      fill: "#b4befe", // Lavender
      empty: "#45475a", // Surface1
    },

    agents: {
      red: "#f38ba8", // Red
      blue: "#89b4fa", // Blue
      green: "#a6e3a1", // Green
      yellow: "#f9e2af", // Yellow
      purple: "#cba6f7", // Mauve
      orange: "#fab387", // Peach
      pink: "#f5c2e7", // Pink
      cyan: "#89dceb", // Sky
    },
  },
}
