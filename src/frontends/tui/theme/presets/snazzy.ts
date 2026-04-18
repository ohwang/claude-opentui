/**
 * Snazzy Theme
 *
 * High-saturation, high-contrast dark theme by Sindre Sorhus.
 * Vivid accent colors on a cool blue-tinted dark background.
 * Gray ramp aligned with the user's Kitty snazzy.conf tweaks
 * (differentiated bright variants, brightened color8).
 *
 * @see https://github.com/sindresorhus/hyper-snazzy
 */

import type { ThemeDefinition } from "../types"

export const snazzy: ThemeDefinition = {
  id: "snazzy",
  name: "Snazzy",
  colors: {
    text: {
      primary: "#eff0eb", // foreground — warm off-white
      secondary: "#a5a5a9", // dimmed foreground (base16 base04)
      secondaryShimmer: "#c8c9c5", // lighter secondary for animations
      muted: "#78787e", // bright black (color8 from kitty config)
      inverse: "#282a36", // background
      thinking: "#848688", // mid-gray (vim-snazzy)
      briefLabel: "#57c7ff", // blue
      briefLabelClaude: "#ff5c57", // coral-red
      // Deprecated aliases
      inactive: "#a5a5a9",
      inactiveShimmer: "#c8c9c5",
      subtle: "#3a3d4d", // dark gray decoration (vim-snazzy)
    },

    bg: {
      primary: "#282a36", // canonical Snazzy background
      surface: "#3e4452", // selection_background from kitty config
      surfaceHover: "#4a4e5e", // slightly lighter surface
      overlay: "#1e1f29", // darker than background
      selection: "#3e4452", // kitty selection_background
      bash: "#32293a", // magenta-tinted dark
      memory: "#282e3e", // blue-tinted dark
    },

    accent: {
      primary: "#ff5c57", // coral-red — warm brand
      primaryShimmer: "#ff7b76", // bright red (color9 from kitty)
      logo: "#ff5c57", // coral-red
      suggestion: "#57c7ff", // blue — interactive
      suggestionShimmer: "#6fd0ff", // bright blue (color12 from kitty)
      permission: "#57c7ff", // blue
      remember: "#57c7ff", // blue
      highlight: "#9aedfe", // cyan
      secondary: "#ff6ac1", // hot pink — Snazzy's signature color
      bash: "#ff6ac1", // hot pink
      planMode: "#9aedfe", // cyan
      ide: "#57c7ff", // blue
      fastMode: "#ff5c57", // coral-red
      fastModeShimmer: "#ff7b76", // bright red
    },

    status: {
      success: "#5af78e", // mint green
      warning: "#f3f99d", // pastel yellow
      warningShimmer: "#f5fbaf", // bright yellow (color11 from kitty)
      error: "#ff5c57", // coral-red
      info: "#57c7ff", // blue
      infoShimmer: "#6fd0ff", // bright blue
      merged: "#ff6ac1", // hot pink
    },

    border: {
      default: "#43454f", // base16 base02 — subtle border
      muted: "#34353e", // base16 base01 — very subtle
      error: "#ff5c57", // coral-red
      permission: "#57c7ff", // blue
      elicitation: "#9aedfe", // cyan
      prompt: "#606580", // blue-tinted gray (vim-snazzy)
      promptShimmer: "#78787e", // bright black
      bash: "#ff6ac1", // hot pink
    },

    state: {
      idle: "#5af78e", // green
      running: "#57c7ff", // blue
      waiting: "#f3f99d", // pastel yellow
      error: "#ff5c57", // coral-red
      shuttingDown: "#78787e", // bright black
    },

    permission: {
      allow: "#5af78e", // green
      alwaysAllow: "#57c7ff", // blue
      deny: "#f3f99d", // pastel yellow
      denySession: "#ff5c57", // coral-red
      modeLabel: "#ff6ac1", // hot pink
    },

    diff: {
      added: "#5af78e", // mint green
      removed: "#ff5c57", // coral-red
      addedBg: "#1a3a28", // darkened green
      removedBg: "#3a1a22", // darkened red
      addedDimmed: "#2f4a38", // muted green tint
      removedDimmed: "#4a2f35", // muted red tint
    },

    rateLimit: {
      fill: "#57c7ff", // blue
      empty: "#43454f", // dark gray
    },

    agents: {
      red: "#ff5c57", // coral-red
      blue: "#57c7ff", // sky blue
      green: "#5af78e", // mint green
      yellow: "#f3f99d", // pastel yellow
      purple: "#a78bfa", // vibrant violet (derived — Snazzy has no canonical purple)
      orange: "#ff9f43", // warm orange (from base16-snazzy)
      pink: "#ff6ac1", // hot pink
      cyan: "#9aedfe", // ice blue
    },
  },
}
