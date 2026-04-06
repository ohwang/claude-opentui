/**
 * Design System -- Semantic Color Tokens
 *
 * Single source of truth for all colors in the TUI.
 * Derived from Claude Code's default dark theme (rgb values).
 * Import from here instead of hardcoding hex values.
 *
 * Reference: claude-code-archive/src/utils/theme.ts  darkTheme
 */

export const colors = {
  // -- Text ---------------------------------------------------------------
  text: {
    primary: "#ffffff",      // rgb(255,255,255)  -- archive: text
    secondary: "#999999",    // rgb(153,153,153)  -- archive: inactive
    muted: "#505050",        // rgb(80,80,80)     -- archive: subtle
    white: "#ffffff",        // Same as primary in dark theme (kept for semantic emphasis)
    link: "#7ab4e8",         // rgb(122,180,232)  -- archive: briefLabelYou
  },

  // -- Backgrounds --------------------------------------------------------
  bg: {
    primary: "#000000",      // rgb(0,0,0)        -- archive: clawd_background
    surface: "#373737",      // rgb(55,55,55)     -- archive: userMessageBackground
    surfaceHover: "#464646", // rgb(70,70,70)     -- archive: userMessageBackgroundHover
    overlay: "#2c323e",      // rgb(44,50,62)     -- archive: messageActionsBackground
    selection: "#264f78",    // rgb(38,79,120)    -- archive: selectionBg
    bash: "#413c41",         // rgb(65,60,65)     -- archive: bashMessageBackgroundColor
    memory: "#374146",       // rgb(55,65,70)     -- archive: memoryBackgroundColor
  },

  // -- Accent -------------------------------------------------------------
  accent: {
    primary: "#d77757",      // rgb(215,119,87)   -- archive: claude (brand orange)
    logo: "#d77757",         // rgb(215,119,87)   -- archive: claude
    periwinkle: "#b1b9f9",   // rgb(177,185,249)  -- archive: permission / suggestion
    cyan: "#00cccc",         // rgb(0,204,204)    -- archive: background (bright cyan)
    secondary: "#af87ff",    // rgb(175,135,255)  -- archive: autoAccept (electric violet)
    bash: "#fd5db1",         // rgb(253,93,177)   -- archive: bashBorder (bright pink)
    planMode: "#48968c",     // rgb(72,150,140)   -- archive: planMode (muted sage)
    ide: "#4782c8",          // rgb(71,130,200)   -- archive: ide (muted blue)
    fastMode: "#ff7814",     // rgb(255,120,20)   -- archive: fastMode (electric orange)
  },

  // -- Status -------------------------------------------------------------
  status: {
    success: "#4eba65",      // rgb(78,186,101)   -- archive: success
    warning: "#ffc107",      // rgb(255,193,7)    -- archive: warning
    error: "#ff6b80",        // rgb(255,107,128)  -- archive: error
    info: "#93a5ff",         // rgb(147,165,255)  -- archive: claudeBlue
    merged: "#af87ff",       // rgb(175,135,255)  -- archive: merged (electric violet)
  },

  // -- Borders ------------------------------------------------------------
  border: {
    default: "#505050",      // rgb(80,80,80)     -- archive: subtle
    muted: "#373737",        // rgb(55,55,55)     -- subtle dividers
    error: "#ff6b80",        // rgb(255,107,128)  -- archive: error
    accent: "#b1b9f9",       // rgb(177,185,249)  -- archive: permission
    elicitation: "#00cccc",  // rgb(0,204,204)    -- archive: background (bright cyan)
    prompt: "#888888",       // rgb(136,136,136)  -- archive: promptBorder
    bash: "#fd5db1",         // rgb(253,93,177)   -- archive: bashBorder
  },

  // -- State indicators ---------------------------------------------------
  state: {
    idle: "#4eba65",         // rgb(78,186,101)   -- archive: success
    running: "#93a5ff",      // rgb(147,165,255)  -- archive: claudeBlue
    waiting: "#ffc107",      // rgb(255,193,7)    -- archive: warning
    error: "#ff6b80",        // rgb(255,107,128)  -- archive: error
    shuttingDown: "#999999", // rgb(153,153,153)  -- archive: inactive
  },

  // -- Permission dialog --------------------------------------------------
  permission: {
    allow: "#4eba65",        // rgb(78,186,101)   -- archive: success
    alwaysAllow: "#b1b9f9",  // rgb(177,185,249)  -- archive: permission
    deny: "#ffc107",         // rgb(255,193,7)    -- archive: warning
    denySession: "#ff6b80",  // rgb(255,107,128)  -- archive: error
    modeLabel: "#af87ff",    // rgb(175,135,255)  -- archive: autoAccept
  },

  // -- Diff ---------------------------------------------------------------
  diff: {
    added: "#38a660",        // rgb(56,166,96)    -- archive: diffAddedWord
    removed: "#b3596b",      // rgb(179,89,107)   -- archive: diffRemovedWord
    addedBg: "#225c2b",      // rgb(34,92,43)     -- archive: diffAdded
    removedBg: "#7a2936",    // rgb(122,41,54)    -- archive: diffRemoved
    addedDimmed: "#47584a",  // rgb(71,88,74)     -- archive: diffAddedDimmed
    removedDimmed: "#69484d",// rgb(105,72,77)    -- archive: diffRemovedDimmed
  },

  // -- Rate limit ---------------------------------------------------------
  rateLimit: {
    fill: "#b1b9f9",         // rgb(177,185,249)  -- archive: rate_limit_fill
    empty: "#505370",        // rgb(80,83,112)    -- archive: rate_limit_empty
  },

  // -- Subagent palette ---------------------------------------------------
  agents: {
    red: "#dc2626",          // rgb(220,38,38)    -- Red 600
    blue: "#2563eb",         // rgb(37,99,235)    -- Blue 600
    green: "#16a34a",        // rgb(22,163,74)    -- Green 600
    yellow: "#ca8a04",       // rgb(202,138,4)    -- Yellow 600
    purple: "#9333ea",       // rgb(147,51,234)   -- Purple 600
    orange: "#ea580c",       // rgb(234,88,12)    -- Orange 600
    pink: "#db2777",         // rgb(219,39,119)   -- Pink 600
    cyan: "#0891b2",         // rgb(8,145,178)    -- Cyan 600
  },
} as const

// Convenience alias
export type HexColor = string
