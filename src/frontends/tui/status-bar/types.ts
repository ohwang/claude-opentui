/**
 * Status Bar Preset — Type Definitions
 *
 * A status bar preset is the native (in-TUI) rendering of the top line of the
 * status bar. Presets range from minimal (just project + model + state) to
 * detailed (cost, git, ctx, rate limits, tok/s, …).
 *
 * The second line (permission mode + sandbox hint + rate-limit percentages)
 * is owned by the outer `StatusBar` component and is NOT part of presets —
 * keeping it consistent across presets means cycling, sandbox hints, and
 * rate-limit display stay uniform.
 *
 * When a user configures `statusLine` (external command), that path takes
 * precedence over all native presets. See `src/utils/statusline.ts`.
 */
import type { Component } from "solid-js"
import type { StatusBarData } from "./data"

/** Props every preset receives from the outer `StatusBar` component. */
export interface StatusBarPresetProps {
  /** Derived, reactive data shared across presets. */
  data: StatusBarData
  /** Transient right-side hint (e.g. "Ctrl+C again to exit"). */
  hint?: string | null
}

/**
 * A status bar preset definition — analogous to `ThemeDefinition`.
 *
 * `render` is a SolidJS component. The component owns ONE line of output
 * (sometimes more if the preset declares it), rendered above the permission
 * mode row. All reactive state it needs arrives via `props.data` so each
 * preset doesn't re-derive from session/agent/messages contexts.
 */
export interface StatusBarPreset {
  /** Unique identifier used in CLI flags, config, and `/status-bar`. */
  id: string
  /** Human-readable name shown in `/status-bar list`. */
  name: string
  /** Short one-line description surfaced in `/status-bar list`. */
  description: string
  /** The SolidJS component that renders line 1 (and optionally more). */
  render: Component<StatusBarPresetProps>
}
