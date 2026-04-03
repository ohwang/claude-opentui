import { describe, expect, it, beforeEach, afterEach, mock } from "bun:test"
import {
  detectTerminal,
  sendTerminalNotification,
  setTerminalProgress,
  wrapForTmux,
} from "../../src/utils/terminal-notify"

// ---------------------------------------------------------------------------
// Helpers — save/restore env vars
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  "TERM_PROGRAM",
  "TERMINAL_EMULATOR",
  "ITERM_SESSION_ID",
  "KITTY_PID",
  "KITTY_WINDOW_ID",
  "TMUX",
] as const

type SavedEnv = Record<string, string | undefined>

function saveEnv(): SavedEnv {
  const saved: SavedEnv = {}
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key]
  }
  return saved
}

function restoreEnv(saved: SavedEnv): void {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = saved[key]
    }
  }
}

function clearTermEnv(): void {
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
}

// ---------------------------------------------------------------------------
// Mock stdout.write
// ---------------------------------------------------------------------------

let writtenData: string[] = []
let originalWrite: typeof process.stdout.write
let originalIsTTY: boolean | undefined

function mockStdout(isTTY = true): void {
  writtenData = []
  originalWrite = process.stdout.write
  originalIsTTY = process.stdout.isTTY
  Object.defineProperty(process.stdout, "isTTY", { value: isTTY, writable: true, configurable: true })
  // @ts-ignore -- overriding write for test (signature mismatch is intentional)
  process.stdout.write = (chunk: string | Uint8Array) => {
    writtenData.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk))
    return true
  }
}

function restoreStdout(): void {
  process.stdout.write = originalWrite
  Object.defineProperty(process.stdout, "isTTY", {
    value: originalIsTTY,
    writable: true,
    configurable: true,
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("detectTerminal", () => {
  let saved: SavedEnv

  beforeEach(() => {
    saved = saveEnv()
    clearTermEnv()
  })

  afterEach(() => {
    restoreEnv(saved)
  })

  it("detects iTerm2 via TERM_PROGRAM", () => {
    process.env.TERM_PROGRAM = "iTerm.app"
    expect(detectTerminal()).toBe("iterm2")
  })

  it("detects iTerm2 via ITERM_SESSION_ID", () => {
    process.env.ITERM_SESSION_ID = "w0t0p0:ABCDEF"
    expect(detectTerminal()).toBe("iterm2")
  })

  it("detects Ghostty via TERM_PROGRAM", () => {
    process.env.TERM_PROGRAM = "ghostty"
    expect(detectTerminal()).toBe("ghostty")
  })

  it("detects Ghostty via TERMINAL_EMULATOR", () => {
    process.env.TERMINAL_EMULATOR = "ghostty"
    expect(detectTerminal()).toBe("ghostty")
  })

  it("detects Kitty via KITTY_PID", () => {
    process.env.KITTY_PID = "12345"
    expect(detectTerminal()).toBe("kitty")
  })

  it("detects Kitty via KITTY_WINDOW_ID", () => {
    process.env.KITTY_WINDOW_ID = "1"
    expect(detectTerminal()).toBe("kitty")
  })

  it("returns unknown when no terminal env vars are set", () => {
    expect(detectTerminal()).toBe("unknown")
  })

  it("prefers iTerm2 over Kitty when both are set", () => {
    process.env.ITERM_SESSION_ID = "w0t0p0:ABC"
    process.env.KITTY_PID = "12345"
    expect(detectTerminal()).toBe("iterm2")
  })

  it("prefers Ghostty over Kitty when both are set", () => {
    process.env.TERM_PROGRAM = "ghostty"
    process.env.KITTY_PID = "12345"
    expect(detectTerminal()).toBe("ghostty")
  })
})

describe("sendTerminalNotification", () => {
  let saved: SavedEnv

  beforeEach(() => {
    saved = saveEnv()
    clearTermEnv()
    mockStdout(true)
  })

  afterEach(() => {
    restoreStdout()
    restoreEnv(saved)
  })

  it("sends OSC 9 for iTerm2", () => {
    process.env.TERM_PROGRAM = "iTerm.app"
    sendTerminalNotification("Claude", "Done")
    expect(writtenData).toHaveLength(1)
    expect(writtenData[0]).toBe("\x1b]9;Claude: Done\x07")
  })

  it("sends OSC 99 for Kitty (title + body)", () => {
    process.env.KITTY_PID = "999"
    sendTerminalNotification("Claude", "Done")
    expect(writtenData).toHaveLength(1)
    expect(writtenData[0]).toContain("\x1b]99;i=1:d=0:p=title;Claude\x1b\\")
    expect(writtenData[0]).toContain("\x1b]99;i=1:p=body;Done\x1b\\")
  })

  it("sends OSC 777 for Ghostty", () => {
    process.env.TERM_PROGRAM = "ghostty"
    sendTerminalNotification("Claude", "Done")
    expect(writtenData).toHaveLength(1)
    expect(writtenData[0]).toBe("\x1b]777;notify;Claude;Done\x1b\\")
  })

  it("sends BEL for unknown terminals", () => {
    sendTerminalNotification("Claude", "Done")
    expect(writtenData).toHaveLength(1)
    expect(writtenData[0]).toBe("\x07")
  })

  it("does nothing when stdout is not a TTY", () => {
    restoreStdout()
    mockStdout(false)
    process.env.TERM_PROGRAM = "iTerm.app"
    sendTerminalNotification("Claude", "Done")
    expect(writtenData).toHaveLength(0)
  })

  it("wraps sequences for tmux when TMUX is set", () => {
    process.env.TMUX = "/tmp/tmux-1000/default,12345,0"
    // Unknown terminal -> bell, but wrapped for tmux
    sendTerminalNotification("Claude", "Done")
    expect(writtenData).toHaveLength(1)
    // Bell \x07 has no \x1b to escape, so tmux wrap adds DCS prefix/suffix around it
    expect(writtenData[0]).toBe("\x1bPtmux;\x07\x1b\\")
  })
})

describe("setTerminalProgress", () => {
  let saved: SavedEnv

  beforeEach(() => {
    saved = saveEnv()
    clearTermEnv()
    mockStdout(true)
  })

  afterEach(() => {
    restoreStdout()
    restoreEnv(saved)
  })

  it("writes running state with percent", () => {
    setTerminalProgress("running", 42)
    expect(writtenData).toHaveLength(1)
    expect(writtenData[0]).toBe("\x1b]9;4;1;42\x07")
  })

  it("writes running state with 0 percent when omitted", () => {
    setTerminalProgress("running")
    expect(writtenData).toHaveLength(1)
    expect(writtenData[0]).toBe("\x1b]9;4;1;0\x07")
  })

  it("writes completed state (code 3)", () => {
    setTerminalProgress("completed", 100)
    expect(writtenData).toHaveLength(1)
    expect(writtenData[0]).toBe("\x1b]9;4;3;100\x07")
  })

  it("writes error state (code 2)", () => {
    setTerminalProgress("error")
    expect(writtenData).toHaveLength(1)
    expect(writtenData[0]).toBe("\x1b]9;4;2;0\x07")
  })

  it("writes clear state (code 0;0)", () => {
    setTerminalProgress("clear")
    expect(writtenData).toHaveLength(1)
    expect(writtenData[0]).toBe("\x1b]9;4;0;0\x07")
  })

  it("does nothing when stdout is not a TTY", () => {
    restoreStdout()
    mockStdout(false)
    setTerminalProgress("running", 50)
    expect(writtenData).toHaveLength(0)
  })

  it("wraps for tmux when TMUX is set", () => {
    process.env.TMUX = "/tmp/tmux-1000/default,12345,0"
    setTerminalProgress("running", 25)
    expect(writtenData).toHaveLength(1)
    // The sequence contains \x1b which gets doubled in tmux passthrough
    expect(writtenData[0]).toContain("\x1bPtmux;")
    expect(writtenData[0]).toContain("\x1b\\")
  })
})

describe("wrapForTmux", () => {
  let saved: SavedEnv

  beforeEach(() => {
    saved = saveEnv()
    clearTermEnv()
  })

  afterEach(() => {
    restoreEnv(saved)
  })

  it("returns sequence unchanged when TMUX is not set", () => {
    const seq = "\x1b]9;Hello\x07"
    expect(wrapForTmux(seq)).toBe(seq)
  })

  it("wraps sequence in DCS passthrough when TMUX is set", () => {
    process.env.TMUX = "/tmp/tmux-1000/default,12345,0"
    const seq = "\x1b]9;Hello\x07"
    const wrapped = wrapForTmux(seq)
    // Should start with DCS tmux;
    expect(wrapped.startsWith("\x1bPtmux;")).toBe(true)
    // Should end with ST
    expect(wrapped.endsWith("\x1b\\")).toBe(true)
  })

  it("doubles escape characters inside tmux passthrough", () => {
    process.env.TMUX = "/tmp/tmux-1000/default,12345,0"
    const seq = "\x1b]9;Hello\x1b\\"
    const wrapped = wrapForTmux(seq)
    // Each \x1b in the original should become \x1b\x1b
    // Original has 2 \x1b characters, so wrapped inner should have 4
    expect(wrapped).toBe("\x1bPtmux;\x1b\x1b]9;Hello\x1b\x1b\\\x1b\\")
  })

  it("handles plain text without escapes", () => {
    process.env.TMUX = "/tmp/tmux-1000/default,12345,0"
    const seq = "\x07" // Just a bell, no \x1b
    const wrapped = wrapForTmux(seq)
    expect(wrapped).toBe("\x1bPtmux;\x07\x1b\\")
  })
})
