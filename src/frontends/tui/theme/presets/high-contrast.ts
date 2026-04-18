/**
 * High Contrast Theme
 *
 * Brighter text, stronger borders, and more vivid status colors
 * for improved readability in bright environments or for users
 * who prefer higher contrast.
 */

import type { ThemeDefinition } from "../types"

export const highContrast: ThemeDefinition = {
  id: "high-contrast",
  name: "High Contrast",
  colors: {
    text: {
      primary: "#ffffff",
      secondary: "#cccccc",
      secondaryShimmer: "#dddddd",
      muted: "#999999",
      inverse: "#000000",
      thinking: "#aaaaaa",
      briefLabel: "#8ec8ff",
      briefLabelClaude: "#f09070",
      // Deprecated aliases
      inactive: "#cccccc",
      inactiveShimmer: "#dddddd",
      subtle: "#666666",
    },

    bg: {
      primary: "#000000",
      surface: "#2a2a2a",
      surfaceHover: "#3a3a3a",
      overlay: "#1e2430",
      selection: "#2a5a90",
      bash: "#352a35",
      memory: "#2a3540",
    },

    accent: {
      primary: "#e88860",
      primaryShimmer: "#f0a888",
      logo: "#e88860",
      suggestion: "#c0c8ff",
      suggestionShimmer: "#d8dfff",
      permission: "#c0c8ff",
      remember: "#c0c8ff",
      highlight: "#00e0e0",
      secondary: "#c0a0ff",
      bash: "#ff70c0",
      planMode: "#55b0a0",
      ide: "#5590d8",
      fastMode: "#ff9030",
      fastModeShimmer: "#ffb060",
    },

    status: {
      success: "#60d080",
      warning: "#ffd030",
      warningShimmer: "#ffe860",
      error: "#ff8090",
      info: "#a0b8ff",
      infoShimmer: "#c0d0ff",
      merged: "#c0a0ff",
    },

    border: {
      default: "#707070",
      muted: "#484848",
      error: "#ff8090",
      permission: "#c0c8ff",
      elicitation: "#00e0e0",
      prompt: "#a0a0a0",
      promptShimmer: "#c0c0c0",
      bash: "#ff70c0",
    },

    state: {
      idle: "#60d080",
      running: "#a0b8ff",
      waiting: "#ffd030",
      error: "#ff8090",
      shuttingDown: "#aaaaaa",
    },

    permission: {
      allow: "#60d080",
      alwaysAllow: "#c0c8ff",
      deny: "#ffd030",
      denySession: "#ff8090",
      modeLabel: "#c0a0ff",
    },

    diff: {
      added: "#48c878",
      removed: "#d06878",
      addedBg: "#1a5028",
      removedBg: "#601828",
      addedDimmed: "#385838",
      removedDimmed: "#583840",
    },

    rateLimit: {
      fill: "#c0c8ff",
      empty: "#505880",
    },

    agents: {
      red: "#ef4444",
      blue: "#3b82f6",
      green: "#22c55e",
      yellow: "#eab308",
      purple: "#a855f7",
      orange: "#f97316",
      pink: "#ec4899",
      cyan: "#06b6d4",
    },
  },
}
