/**
 * Design System -- Semantic Color Tokens
 *
 * Single source of truth for all colors in the TUI.
 * Import from here instead of hardcoding hex values.
 */

export const colors = {
  // -- Text ---------------------------------------------------------------
  text: {
    primary: "#e4e4e4",      // Main content text (assistant responses)
    secondary: "#a8a8a8",    // Metadata, timestamps, tool summaries
    muted: "#808080",        // Dim/subtle text, hints, separators
    white: "#ffffff",        // High emphasis (user input, tool names)
    link: "#6bcbf5",         // Links (if used)
  },

  // -- Backgrounds --------------------------------------------------------
  bg: {
    primary: "#1e1e2e",      // Terminal default (not set, inherited)
    surface: "#3a3a3a",      // User message background
    overlay: "#1a1a2e",      // Popup/overlay background (diagnostics)
    selection: "#4a4a6a",    // Text selection highlight
  },

  // -- Accent -------------------------------------------------------------
  accent: {
    primary: "#d78787",      // Logo, branding, salmon/pink
    logo: "#d7875f",         // Header bar logo warm orange
    periwinkle: "#afd7ff",   // Permission dialog accent
    cyan: "#87ceeb",         // Elicitation accent
  },

  // -- Status -------------------------------------------------------------
  status: {
    success: "#87d787",      // Green -- success, diff added
    warning: "#d7af5f",      // Yellow/amber -- long-running tools
    error: "#ff5f5f",        // Red -- errors, failures
    info: "#87ceeb",         // Cyan -- info, running state
  },

  // -- Borders ------------------------------------------------------------
  border: {
    default: "#4a4a6a",      // Panel borders
    muted: "#3a3a3a",        // Subtle dividers (dash lines)
    error: "red",            // Error borders
    accent: "#afd7ff",       // Permission dialog border
    elicitation: "cyan",     // Elicitation dialog border
  },

  // -- State indicators ---------------------------------------------------
  state: {
    idle: "green",
    running: "cyan",
    waiting: "yellow",
    error: "red",
    shuttingDown: "gray",
  },

  // -- Permission dialog --------------------------------------------------
  permission: {
    allow: "#87d787",        // Green for allow
    alwaysAllow: "#afd7ff",  // Blue for always allow
    deny: "#d7af5f",         // Amber for deny
    denySession: "#ff5f5f",  // Red for deny session
    modeLabel: "#d787af",    // Purple for permission mode
  },

  // -- Diff ---------------------------------------------------------------
  diff: {
    added: "#87d787",
    removed: "#d78787",
    addedBg: "#1a2e1a",     // Green tint background for added lines
    removedBg: "#2e1a1a",   // Red tint background for removed lines
  },
} as const

// Convenience alias
export type HexColor = string
