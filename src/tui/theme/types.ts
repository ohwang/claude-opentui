/**
 * Theme Type Definitions
 *
 * Defines the shape of a theme and its color tokens.
 * All theme presets implement ThemeDefinition.
 * The runtime `colors` object in tokens.ts is typed as ThemeColors.
 */

// ---------------------------------------------------------------------------
// Color token interfaces — one per semantic category
// ---------------------------------------------------------------------------

export interface TextTokens {
  primary: string
  secondary: string
  secondaryShimmer: string
  muted: string
  inverse: string
  thinking: string
  briefLabel: string
  briefLabelClaude: string
  /** Input cursor color. Defaults to text.primary if omitted. */
  cursor?: string

  /** @deprecated Use `secondary` instead. Alias kept for unconverted code. */
  inactive: string
  /** @deprecated Use `secondaryShimmer` instead. */
  inactiveShimmer: string
  /** @deprecated Use `muted` for dim hints, or `border.default` for structural glyphs. */
  subtle: string
}

export interface BgTokens {
  /** Base terminal background. Omit to inherit the terminal's own background. */
  primary?: string
  surface: string
  surfaceHover: string
  overlay: string
  selection: string
  bash: string
  memory: string
}

export interface AccentTokens {
  primary: string
  primaryShimmer: string
  logo: string
  suggestion: string
  suggestionShimmer: string
  permission: string
  remember: string
  highlight: string
  secondary: string
  bash: string
  planMode: string
  ide: string
  fastMode: string
  fastModeShimmer: string
}

export interface StatusTokens {
  success: string
  warning: string
  warningShimmer: string
  error: string
  info: string
  infoShimmer: string
  merged: string
}

export interface BorderTokens {
  default: string
  muted: string
  error: string
  permission: string
  elicitation: string
  prompt: string
  promptShimmer: string
  bash: string
}

export interface StateTokens {
  idle: string
  running: string
  waiting: string
  error: string
  shuttingDown: string
}

export interface PermissionTokens {
  allow: string
  alwaysAllow: string
  deny: string
  denySession: string
  modeLabel: string
}

export interface DiffTokens {
  added: string
  removed: string
  addedBg: string
  removedBg: string
  addedDimmed: string
  removedDimmed: string
}

export interface RateLimitTokens {
  fill: string
  empty: string
}

export interface AgentTokens {
  red: string
  blue: string
  green: string
  yellow: string
  purple: string
  orange: string
  pink: string
  cyan: string
}

// ---------------------------------------------------------------------------
// Composite types
// ---------------------------------------------------------------------------

/** Complete set of color tokens for a theme. */
export interface ThemeColors {
  text: TextTokens
  bg: BgTokens
  accent: AccentTokens
  status: StatusTokens
  border: BorderTokens
  state: StateTokens
  permission: PermissionTokens
  diff: DiffTokens
  rateLimit: RateLimitTokens
  agents: AgentTokens
}

/** A complete theme definition with metadata and colors. */
export interface ThemeDefinition {
  /** Unique identifier used in CLI flags and config. */
  id: string
  /** Human-readable name shown in `/theme list`. */
  name: string
  /** Full color token set. */
  colors: ThemeColors
}
