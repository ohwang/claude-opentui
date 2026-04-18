/**
 * Dracula Theme
 *
 * Vibrant, high-contrast dark theme with purple-heavy accents.
 * Uses the official Dracula palette.
 *
 * @see https://draculatheme.com
 */

import type { ThemeDefinition } from "../types"

export const dracula: ThemeDefinition = {
  id: "dracula",
  name: "Dracula",
  colors: {
    text: {
      primary: "#f8f8f2", // Foreground
      secondary: "#bfbfbf", // Slightly dimmed foreground
      secondaryShimmer: "#e0e0e0", // Brighter on shimmer
      muted: "#6272a4", // Comment
      inverse: "#282a36", // Background
      thinking: "#6272a4", // Comment
      briefLabel: "#8be9fd", // Cyan
      briefLabelClaude: "#ffb86c", // Orange
      // Deprecated aliases
      inactive: "#bfbfbf",
      inactiveShimmer: "#e0e0e0",
      subtle: "#44475a", // Current Line
    },

    bg: {
      primary: "#282a36", // Background
      surface: "#44475a", // Current Line / Selection
      surfaceHover: "#525680", // Lightened selection
      overlay: "#21222c", // Darker than background
      selection: "#44475a", // Selection
      bash: "#3b2d44", // Purple-tinted dark
      memory: "#2d3544", // Blue-tinted dark
    },

    accent: {
      primary: "#ffb86c", // Orange — warm brand
      primaryShimmer: "#ffd9a8", // Lightened orange
      logo: "#bd93f9", // Purple — Dracula's signature
      suggestion: "#bd93f9", // Purple
      suggestionShimmer: "#d4b8ff", // Light purple
      permission: "#bd93f9", // Purple
      remember: "#bd93f9", // Purple
      highlight: "#8be9fd", // Cyan
      secondary: "#ff79c6", // Pink
      bash: "#ff79c6", // Pink
      planMode: "#8be9fd", // Cyan
      ide: "#bd93f9", // Purple
      fastMode: "#ffb86c", // Orange
      fastModeShimmer: "#ffd9a8", // Light orange
    },

    status: {
      success: "#50fa7b", // Green
      warning: "#f1fa8c", // Yellow
      warningShimmer: "#f8ffc4", // Light yellow
      error: "#ff5555", // Red
      info: "#bd93f9", // Purple
      infoShimmer: "#d4b8ff", // Light purple
      merged: "#ff79c6", // Pink
    },

    border: {
      default: "#6272a4", // Comment
      muted: "#44475a", // Current Line
      error: "#ff5555", // Red
      permission: "#bd93f9", // Purple
      elicitation: "#8be9fd", // Cyan
      prompt: "#6272a4", // Comment
      promptShimmer: "#8998c4", // Lightened comment
      bash: "#ff79c6", // Pink
    },

    state: {
      idle: "#50fa7b", // Green
      running: "#bd93f9", // Purple
      waiting: "#f1fa8c", // Yellow
      error: "#ff5555", // Red
      shuttingDown: "#6272a4", // Comment
    },

    permission: {
      allow: "#50fa7b", // Green
      alwaysAllow: "#bd93f9", // Purple
      deny: "#f1fa8c", // Yellow
      denySession: "#ff5555", // Red
      modeLabel: "#ff79c6", // Pink
    },

    diff: {
      added: "#50fa7b", // Green
      removed: "#ff5555", // Red
      addedBg: "#1a3a25", // Darkened green
      removedBg: "#4a1a1a", // Darkened red
      addedDimmed: "#2f4a35", // Muted green tint
      removedDimmed: "#4a2f2f", // Muted red tint
    },

    rateLimit: {
      fill: "#bd93f9", // Purple
      empty: "#44475a", // Current Line
    },

    agents: {
      red: "#ff5555", // Red
      blue: "#8be9fd", // Cyan (Dracula uses cyan as its blue)
      green: "#50fa7b", // Green
      yellow: "#f1fa8c", // Yellow
      purple: "#bd93f9", // Purple
      orange: "#ffb86c", // Orange
      pink: "#ff79c6", // Pink
      cyan: "#8be9fd", // Cyan
    },
  },
}
