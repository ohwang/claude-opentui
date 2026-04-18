/**
 * Solarized Dark Theme
 *
 * Ethan Schoonover's precision-designed palette with careful contrast ratios.
 * Muted, warm tones on a teal-tinted dark background.
 *
 * @see https://ethanschoonover.com/solarized/
 */

import type { ThemeDefinition } from "../types"

export const solarizedDark: ThemeDefinition = {
  id: "solarized-dark",
  name: "Solarized Dark",
  colors: {
    text: {
      primary: "#839496", // base0 — body text
      secondary: "#657b83", // base00 — secondary content (dimmer than primary)
      secondaryShimmer: "#839496", // base0 — shimmer target for secondary animations
      muted: "#586e75", // base01 — comments / muted
      inverse: "#fdf6e3", // base3 — light bg (inverse)
      thinking: "#657b83", // base00 — mid-tone
      briefLabel: "#268bd2", // blue
      briefLabelClaude: "#cb4b16", // orange
      // Deprecated aliases
      inactive: "#657b83", // base00
      inactiveShimmer: "#839496", // base0
      subtle: "#073642", // base02
    },

    bg: {
      primary: "#002b36", // base03 — darkest background
      surface: "#073642", // base02 — surface
      surfaceHover: "#0a4050", // Slightly lighter than base02
      overlay: "#001e27", // Darker than base03
      selection: "#073642", // base02
      bash: "#0a2a30", // Cyan-tinted dark
      memory: "#0a2530", // Blue-tinted dark
    },

    accent: {
      primary: "#cb4b16", // orange — warm brand
      primaryShimmer: "#dc6a3a", // Lightened orange
      logo: "#cb4b16", // orange
      suggestion: "#6c71c4", // violet
      suggestionShimmer: "#8a8ed8", // Lightened violet
      permission: "#6c71c4", // violet
      remember: "#6c71c4", // violet
      highlight: "#2aa198", // cyan
      secondary: "#d33682", // magenta
      bash: "#d33682", // magenta
      planMode: "#2aa198", // cyan
      ide: "#268bd2", // blue
      fastMode: "#cb4b16", // orange
      fastModeShimmer: "#dc6a3a", // Lightened orange
    },

    status: {
      success: "#859900", // green
      warning: "#b58900", // yellow
      warningShimmer: "#d4a300", // Brightened yellow
      error: "#dc322f", // red
      info: "#268bd2", // blue
      infoShimmer: "#4aa3e6", // Brightened blue
      merged: "#6c71c4", // violet
    },

    border: {
      default: "#586e75", // base01
      muted: "#073642", // base02
      error: "#dc322f", // red
      permission: "#6c71c4", // violet
      elicitation: "#2aa198", // cyan
      prompt: "#657b83", // base00
      promptShimmer: "#839496", // base0
      bash: "#d33682", // magenta
    },

    state: {
      idle: "#859900", // green
      running: "#268bd2", // blue
      waiting: "#b58900", // yellow
      error: "#dc322f", // red
      shuttingDown: "#657b83", // base00
    },

    permission: {
      allow: "#859900", // green
      alwaysAllow: "#6c71c4", // violet
      deny: "#b58900", // yellow
      denySession: "#dc322f", // red
      modeLabel: "#d33682", // magenta
    },

    diff: {
      added: "#859900", // green
      removed: "#dc322f", // red
      addedBg: "#1a3000", // Darkened green
      removedBg: "#3a0a0a", // Darkened red
      addedDimmed: "#2a3a20", // Muted green tint
      removedDimmed: "#3a2020", // Muted red tint
    },

    rateLimit: {
      fill: "#268bd2", // blue
      empty: "#073642", // base02
    },

    agents: {
      red: "#dc322f", // red
      blue: "#268bd2", // blue
      green: "#859900", // green
      yellow: "#b58900", // yellow
      purple: "#6c71c4", // violet
      orange: "#cb4b16", // orange
      pink: "#d33682", // magenta
      cyan: "#2aa198", // cyan
    },
  },
}
