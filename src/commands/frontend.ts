/**
 * FrontendBridge — the seam between frontend-neutral command logic and
 * frontend-specific UI (OpenTUI panels, Slack Block Kit, Electron windows, …).
 *
 * Slash commands receive a `FrontendBridge` via `CommandContext.frontend` and
 * must never import from `src/tui/` or `@opentui/*` directly. A frontend
 * implements the bridge and passes it when it constructs a `CommandContext`.
 *
 * This file deliberately has **no** TUI imports. It is the reason the
 * command registry can be consumed by a non-TUI frontend.
 */

/**
 * Identifiers for rich panels that a frontend may know how to render.
 *
 * The string literal union is informative — frontends are free to accept
 * additional kinds. Unknown kinds should be logged and treated as a no-op.
 */
export type PanelKind =
  | "help"
  | "hotkeys"
  | "about"
  | "ab"
  | (string & {})

/** Data passed to the "help" panel. */
export interface HelpPanelData {
  commands: Array<{
    name: string
    description: string
    aliases?: string[]
    argumentHint?: string
    type?: "local" | "prompt"
  }>
}

/** Data passed to the "ab" panel (A/B comparison modal). */
export interface AbPanelData {
  orchestrator: unknown // OrchestratorHandle — opaque to core
  onDismiss: () => void
}

/**
 * Frontend capability surface available to slash commands and any other
 * frontend-neutral code that needs to ask the hosting UI to do something.
 *
 * All methods are optional so a minimally-featured frontend (e.g. headless
 * runner) can implement only the parts it cares about. Commands should treat
 * missing methods as "not supported in this frontend" — typically by pushing
 * an ephemeral `system_message` event instead.
 */
export interface FrontendBridge {
  /**
   * Open a named panel. The frontend decides how to render it. `data` is
   * panel-specific and should match the typed payload for the kind.
   */
  openPanel?(kind: PanelKind, data?: unknown): void

  /** Dismiss whatever panel/overlay is currently open, if any. */
  dismissPanel?(): void

  /**
   * Capture the current screen. TUI implementations write two files (plain
   * text + ANSI) and return their paths. Non-TUI frontends typically return
   * `null` so the command can inform the user that screenshot is unsupported.
   */
  screenshot?(opts?: {
    baseName?: string
  }): Promise<{ txtPath: string; ansPath: string } | null>

  /**
   * Copy arbitrary text to the system clipboard where supported. Returns
   * `true` if the frontend was able to copy, `false` otherwise.
   */
  copy?(text: string): Promise<boolean>
}

/**
 * A no-op bridge. Useful for tests and for the headless runner, which does
 * not render panels or capture screens.
 */
export const noopFrontendBridge: FrontendBridge = {
  openPanel: () => {},
  dismissPanel: () => {},
  screenshot: async () => null,
  copy: async () => false,
}
