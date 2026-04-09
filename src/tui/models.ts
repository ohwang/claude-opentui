/**
 * Model metadata — single source of truth for model display names and context windows.
 *
 * Consumed by header-bar, conversation, and status-bar components.
 */

/** Map raw API model IDs to friendly display names */
export const MODEL_NAMES: Record<string, string> = {
  "claude-opus-4-6": "Opus 4.6",
  "claude-sonnet-4-6": "Sonnet 4.6",
  "claude-haiku-4-5-20251001": "Haiku 4.5",
  "claude-sonnet-4-5-20250514": "Sonnet 4.5",
  "claude-3-5-sonnet-20241022": "Sonnet 3.5",
  "claude-3-5-haiku-20241022": "Haiku 3.5",
}

/** Model context window sizes (in tokens) for context usage calculation */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "claude-opus-4-6": 1_000_000,
  "claude-sonnet-4-6": 200_000,
  "claude-haiku-4-5-20251001": 200_000,
  "claude-sonnet-4-5-20250514": 200_000,
  "claude-3-5-sonnet-20241022": 200_000,
  "claude-3-5-haiku-20241022": 200_000,
}

export const DEFAULT_CONTEXT_WINDOW = 200_000

/** Convert raw model IDs to friendly display names, stripping "Claude " prefix as fallback */
export function friendlyModelName(name: string): string {
  if (MODEL_NAMES[name]) return MODEL_NAMES[name]
  return name.replace(/^[Cc]laude\s+/, "")
}

/** Convert backend capability name to a user-facing brand name */
export function friendlyBackendName(backendName: string): string {
  if (backendName.startsWith("claude")) return "Claude"
  if (backendName === "gemini") return "Gemini"
  if (backendName === "codex" || backendName === "codex-sdk") return "Codex"
  return "the assistant"
}
