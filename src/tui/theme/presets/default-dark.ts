/**
 * Default Dark Theme
 *
 * The built-in dark theme derived from Claude Code's default palette.
 * This is the baseline visual identity for bantai.
 */

import type { ThemeDefinition } from "../types"

export const defaultDark: ThemeDefinition = {
  id: "dark",
  name: "Dark",
  colors: {
    text: {
      primary: "#ffffff",
      secondary: "#b0b0b0",
      secondaryShimmer: "#c1c1c1",
      muted: "#777777",
      inverse: "#000000",
      thinking: "#808080",
      briefLabel: "#7ab4e8",
      briefLabelClaude: "#d77757",
      // Deprecated aliases
      inactive: "#b0b0b0",
      inactiveShimmer: "#c1c1c1",
      subtle: "#505050",
    },

    bg: {
      // primary omitted — inherit the terminal's own background color
      surface: "#373737",
      surfaceHover: "#464646",
      overlay: "#2c323e",
      selection: "#264f78",
      bash: "#413c41",
      memory: "#374146",
    },

    accent: {
      primary: "#d77757",
      primaryShimmer: "#eb9f7f",
      logo: "#d77757",
      suggestion: "#b1b9f9",
      suggestionShimmer: "#cfd7ff",
      permission: "#b1b9f9",
      remember: "#b1b9f9",
      highlight: "#00cccc",
      secondary: "#af87ff",
      bash: "#fd5db1",
      planMode: "#48968c",
      ide: "#4782c8",
      fastMode: "#ff7814",
      fastModeShimmer: "#ffa546",
    },

    status: {
      success: "#4eba65",
      warning: "#ffc107",
      warningShimmer: "#ffdf39",
      error: "#ff6b80",
      info: "#93a5ff",
      infoShimmer: "#b1c3ff",
      merged: "#af87ff",
    },

    border: {
      default: "#505050",
      muted: "#373737",
      error: "#ff6b80",
      permission: "#b1b9f9",
      elicitation: "#00cccc",
      prompt: "#888888",
      promptShimmer: "#a6a6a6",
      bash: "#fd5db1",
    },

    state: {
      idle: "#4eba65",
      running: "#93a5ff",
      waiting: "#ffc107",
      error: "#ff6b80",
      shuttingDown: "#999999",
    },

    permission: {
      allow: "#4eba65",
      alwaysAllow: "#b1b9f9",
      deny: "#ffc107",
      denySession: "#ff6b80",
      modeLabel: "#af87ff",
    },

    diff: {
      added: "#38a660",
      removed: "#b3596b",
      addedBg: "#225c2b",
      removedBg: "#7a2936",
      addedDimmed: "#47584a",
      removedDimmed: "#69484d",
    },

    rateLimit: {
      fill: "#b1b9f9",
      empty: "#505370",
    },

    agents: {
      red: "#dc2626",
      blue: "#2563eb",
      green: "#16a34a",
      yellow: "#ca8a04",
      purple: "#9333ea",
      orange: "#ea580c",
      pink: "#db2777",
      cyan: "#0891b2",
    },
  },
}
