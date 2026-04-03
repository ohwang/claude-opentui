/**
 * Terminal Notification Support
 *
 * Sends desktop notifications via terminal escape sequences.
 * Supports iTerm2 (OSC 9), Kitty (OSC 99), Ghostty (OSC 777), and basic bell.
 *
 * Also provides terminal progress indicators (iTerm2/Ghostty OSC 9;4)
 * and tmux passthrough wrapping.
 */

export type TerminalEmulator = "iterm2" | "kitty" | "ghostty" | "unknown"

/**
 * Detect the current terminal emulator from environment variables.
 */
export function detectTerminal(): TerminalEmulator {
  const termProgram = process.env.TERM_PROGRAM ?? ""
  const terminalEmulator = process.env.TERMINAL_EMULATOR ?? ""

  if (termProgram === "iTerm.app" || process.env.ITERM_SESSION_ID) return "iterm2"
  if (termProgram === "ghostty" || terminalEmulator === "ghostty") return "ghostty"
  if (process.env.KITTY_PID || process.env.KITTY_WINDOW_ID) return "kitty"

  return "unknown"
}

/**
 * Send a desktop notification via terminal escape sequences.
 *
 * Supports iTerm2 (OSC 9), Kitty (OSC 99), Ghostty (OSC 777), and basic bell.
 * Only writes when stdout is a TTY to avoid corrupting piped output.
 */
export function sendTerminalNotification(title: string, message: string): void {
  if (!process.stdout.isTTY) return

  const term = detectTerminal()
  let sequence: string

  switch (term) {
    case "iterm2":
      // iTerm2: OSC 9 ; message ST
      sequence = `\x1b]9;${title}: ${message}\x07`
      break
    case "kitty":
      // Kitty: OSC 99 ; i=1:d=0:p=title ; title ST + OSC 99 ; i=1:p=body ; body ST
      sequence =
        `\x1b]99;i=1:d=0:p=title;${title}\x1b\\` +
        `\x1b]99;i=1:p=body;${message}\x1b\\`
      break
    case "ghostty":
      // Ghostty: OSC 777 ; notify ; title ; message ST
      sequence = `\x1b]777;notify;${title};${message}\x1b\\`
      break
    default:
      // Basic bell as fallback (lights up terminal in tmux, etc.)
      sequence = "\x07"
      break
  }

  process.stdout.write(wrapForTmux(sequence))
}

/**
 * Set terminal progress indicator (iTerm2, Ghostty).
 *
 * state: 'running' | 'completed' | 'error' | 'clear'
 *
 * Uses OSC 9;4 escape sequence:
 *   state 0 = remove progress, 1 = running, 2 = paused/error, 3 = completed
 */
export function setTerminalProgress(
  state: "running" | "completed" | "error" | "clear",
  percent?: number,
): void {
  if (!process.stdout.isTTY) return

  let sequence: string

  if (state === "clear") {
    sequence = "\x1b]9;4;0;0\x07"
  } else {
    const stateCode = state === "running" ? 1 : state === "error" ? 2 : 3
    sequence = `\x1b]9;4;${stateCode};${percent ?? 0}\x07`
  }

  process.stdout.write(wrapForTmux(sequence))
}

/**
 * Wrap an escape sequence for tmux passthrough.
 *
 * When running inside tmux, escape sequences must be wrapped in a DCS
 * passthrough block so the outer terminal receives them.
 */
export function wrapForTmux(sequence: string): string {
  if (!process.env.TMUX) return sequence
  // DCS tmux; <escaped sequence> ST
  const escaped = sequence.replace(/\x1b/g, "\x1b\x1b")
  return `\x1bPtmux;${escaped}\x1b\\`
}
