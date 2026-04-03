/**
 * Terminal focus detection via DECSET 1004.
 *
 * When enabled, the terminal sends:
 *   ESC [ I  — focus gained
 *   ESC [ O  — focus lost
 *
 * Widely supported: iTerm2, Kitty, Ghostty, Windows Terminal, xterm.
 * tmux requires `set -g focus-events on` in .tmux.conf.
 * If unsupported, focus events simply never fire (graceful degradation).
 */

type FocusCallback = (focused: boolean) => void

let listeners: FocusCallback[] = []
let enabled = false
let lastFocusState: boolean | null = null

function handleFocusData(data: Buffer): void {
  const str = data.toString()
  if (str.includes("\x1b[I")) {
    lastFocusState = true
    for (const cb of listeners) cb(true)
  } else if (str.includes("\x1b[O")) {
    lastFocusState = false
    for (const cb of listeners) cb(false)
  }
}

export function enableFocusReporting(): void {
  if (enabled) return
  enabled = true
  // Enable focus reporting
  process.stdout.write("\x1b[?1004h")

  // Listen for focus events on stdin
  process.stdin.on("data", handleFocusData)

  // Disable on exit
  process.on("exit", () => {
    process.stdout.write("\x1b[?1004l")
  })
}

export function onFocusChange(callback: FocusCallback): () => void {
  listeners.push(callback)
  return () => {
    listeners = listeners.filter((l) => l !== callback)
  }
}

export function isFocused(): boolean | null {
  return lastFocusState
}

export function disableFocusReporting(): void {
  if (!enabled) return
  enabled = false
  process.stdout.write("\x1b[?1004l")
  process.stdin.off("data", handleFocusData)
}

// ---------------------------------------------------------------------------
// Testing helpers — exported for unit tests only
// ---------------------------------------------------------------------------

/** Reset module state for isolated tests. */
export function _resetForTest(): void {
  listeners = []
  enabled = false
  lastFocusState = null
}

/** Simulate incoming focus data (bypass stdin). */
export function _simulateFocusData(str: string): void {
  handleFocusData(Buffer.from(str))
}

/** Check whether focus reporting is currently enabled. */
export function _isEnabled(): boolean {
  return enabled
}
