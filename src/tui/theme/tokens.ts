/**
 * Design System -- Semantic Color Tokens
 *
 * Single source of truth for all colors in the TUI.
 * Derived from Claude Code's default dark theme (rgb values).
 * Import from here instead of hardcoding hex values.
 *
 * Reference: claude-code-archive/src/utils/theme.ts  darkTheme
 *
 * ═══════════════════════════════════════════════════════════════════════
 * TEXT HIERARCHY — choosing the right gray
 * ═══════════════════════════════════════════════════════════════════════
 *
 * The three text grays serve distinct purposes. Picking the wrong one
 * is the #1 source of visual bugs (text too dim or too bright).
 *
 *   text.primary   #ffffff   Main content: assistant responses, user input,
 *                            tool names, anything the user *reads*.
 *
 *   text.secondary #999999   Readable metadata: version strings, model info,
 *                            timestamps, file paths, cost, token counts.
 *                            Still clearly legible — just less prominent.
 *
 *   text.muted     #505050   Decorative / structural: dash-line dividers,
 *                            table borders, conceal markers, the faintest
 *                            inline hints. NOT for text the user needs to
 *                            read at a glance.
 *
 *   ⚠️  ANTI-PATTERN: text.muted + TextAttributes.DIM
 *       Combining muted (#505050) with DIM produces near-invisible text
 *       on dark backgrounds. If you need dim-but-readable text (shortcut
 *       hints, "shift+tab", collapsed info), use text.secondary instead.
 *       Reserve text.muted for non-text decorations (lines, bullets,
 *       table chrome) where low contrast is intentional.
 *
 *       ✗  <text fg={colors.text.muted} attributes={TextAttributes.DIM}>v0.1</text>
 *       ✓  <text fg={colors.text.secondary}>v0.1</text>
 *
 * ═══════════════════════════════════════════════════════════════════════
 * BACKGROUND TOKENS — when to use what
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   bg.primary     #000000   Base terminal background. Rarely set explicitly
 *                            — the terminal's own bg is inherited.
 *
 *   bg.surface     #373737   Elevated surface: user message bubbles, input
 *                            areas. Provides a subtle lift against the
 *                            terminal default.
 *
 *   bg.overlay     #2c323e   Popovers, modals, diagnostics panels.
 *                            Cool-shifted gray to feel "above" surface.
 *
 *   bg.selection   #264f78   Text selection highlight. Classic VS Code blue.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * STATUS vs STATE — similar but different
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   status.*   Semantic meanings (success/warning/error/info) for any
 *              context: toast notifications, inline badges, cost display.
 *
 *   state.*    Agent lifecycle states (idle/running/waiting/error) for
 *              the status bar indicator dot. Each maps to a status color
 *              but with its own token so they can diverge later.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * GENERAL RULES
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   1. Never hardcode hex values in components. Import from this file.
 *   2. Use hex strings, not ANSI numbers — `fg="#ff6b80"` not `fg={255}`.
 *      ANSI numbers crash the Zig FFI.
 *   3. Use `fg=` on <text>, `backgroundColor=` on <box>. The `bg=` prop
 *      only works on <text> elements; on <box> it is silently ignored.
 *   4. Prefer semantic tokens (status.error) over raw palette tokens
 *      (agents.red) unless you genuinely need the agent palette.
 *   5. When adding a new color, check if an existing token already
 *      covers the use case before creating a new one.
 */

export const colors = {
  // -- Text ---------------------------------------------------------------
  // See "TEXT HIERARCHY" above for usage guidance.
  text: {
    primary: "#ffffff",      // rgb(255,255,255)  -- archive: text
    secondary: "#999999",    // rgb(153,153,153)  -- archive: inactive
    muted: "#505050",        // rgb(80,80,80)     -- archive: subtle  ⚠️ read docs above
    white: "#ffffff",        // Same as primary in dark theme (kept for semantic emphasis)
    link: "#7ab4e8",         // rgb(122,180,232)  -- archive: briefLabelYou
  },

  // -- Backgrounds --------------------------------------------------------
  // See "BACKGROUND TOKENS" above for usage guidance.
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
  // Brand and feature-mode colors. primary/logo are the Claude orange;
  // secondary is electric violet used for autoAccept and merged badges.
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
  // Semantic status colors. Use for toasts, badges, inline indicators.
  // See "STATUS vs STATE" above.
  status: {
    success: "#4eba65",      // rgb(78,186,101)   -- archive: success
    warning: "#ffc107",      // rgb(255,193,7)    -- archive: warning
    error: "#ff6b80",        // rgb(255,107,128)  -- archive: error
    info: "#93a5ff",         // rgb(147,165,255)  -- archive: claudeBlue
    merged: "#af87ff",       // rgb(175,135,255)  -- archive: merged (electric violet)
  },

  // -- Borders ------------------------------------------------------------
  // default/muted are for structural lines; named borders are for specific
  // UI areas (permission dialog, input prompt, bash output).
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
  // Agent lifecycle colors for the status bar dot / label.
  // See "STATUS vs STATE" above.
  state: {
    idle: "#4eba65",         // rgb(78,186,101)   -- archive: success
    running: "#93a5ff",      // rgb(147,165,255)  -- archive: claudeBlue
    waiting: "#ffc107",      // rgb(255,193,7)    -- archive: warning
    error: "#ff6b80",        // rgb(255,107,128)  -- archive: error
    shuttingDown: "#999999", // rgb(153,153,153)  -- archive: inactive
  },

  // -- Permission dialog --------------------------------------------------
  // Button/label colors inside the permission approval dialog.
  permission: {
    allow: "#4eba65",        // rgb(78,186,101)   -- archive: success
    alwaysAllow: "#b1b9f9",  // rgb(177,185,249)  -- archive: permission
    deny: "#ffc107",         // rgb(255,193,7)    -- archive: warning
    denySession: "#ff6b80",  // rgb(255,107,128)  -- archive: error
    modeLabel: "#af87ff",    // rgb(175,135,255)  -- archive: autoAccept
  },

  // -- Diff ---------------------------------------------------------------
  // Word-level foreground colors (added/removed) and line-level background
  // tints (addedBg/removedBg). Dimmed variants for context lines.
  diff: {
    added: "#38a660",        // rgb(56,166,96)    -- archive: diffAddedWord
    removed: "#b3596b",      // rgb(179,89,107)   -- archive: diffRemovedWord
    addedBg: "#225c2b",      // rgb(34,92,43)     -- archive: diffAdded
    removedBg: "#7a2936",    // rgb(122,41,54)    -- archive: diffRemoved
    addedDimmed: "#47584a",  // rgb(71,88,74)     -- archive: diffAddedDimmed
    removedDimmed: "#69484d",// rgb(105,72,77)    -- archive: diffRemovedDimmed
  },

  // -- Rate limit ---------------------------------------------------------
  // Progress bar for context window / rate limit usage.
  rateLimit: {
    fill: "#b1b9f9",         // rgb(177,185,249)  -- archive: rate_limit_fill
    empty: "#505370",        // rgb(80,83,112)    -- archive: rate_limit_empty
  },

  // -- Subagent palette ---------------------------------------------------
  // Distinct hues for differentiating parallel subagents. Tailwind 600.
  // Use ONLY for subagent identification; prefer status.* or accent.*
  // for semantic meaning.
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
