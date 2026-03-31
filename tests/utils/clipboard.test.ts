import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test"
import {
  getClipboardCmd,
  getClipboardReadCmd,
  copyToClipboard,
  readClipboard,
} from "../../src/utils/clipboard"

// ── Helpers for overriding process.platform ──────────────────────────────
const originalPlatform = process.platform

function setPlatform(p: string) {
  Object.defineProperty(process, "platform", { value: p, writable: true })
}

function restorePlatform() {
  Object.defineProperty(process, "platform", {
    value: originalPlatform,
    writable: true,
  })
}

// ── 1. getClipboardCmd() ─────────────────────────────────────────────────
describe("getClipboardCmd", () => {
  afterEach(() => {
    restorePlatform()
    delete process.env.WSL_DISTRO_NAME
  })

  it("returns pbcopy on darwin", () => {
    setPlatform("darwin")
    expect(getClipboardCmd()).toEqual({ cmd: "pbcopy", args: [] })
  })

  it("returns xclip on linux without WSL", () => {
    setPlatform("linux")
    delete process.env.WSL_DISTRO_NAME
    expect(getClipboardCmd()).toEqual({
      cmd: "xclip",
      args: ["-selection", "clipboard"],
    })
  })

  it("returns clip.exe on linux with WSL_DISTRO_NAME", () => {
    setPlatform("linux")
    process.env.WSL_DISTRO_NAME = "Ubuntu"
    expect(getClipboardCmd()).toEqual({ cmd: "clip.exe", args: [] })
  })

  it("returns clip.exe on win32", () => {
    setPlatform("win32")
    expect(getClipboardCmd()).toEqual({ cmd: "clip.exe", args: [] })
  })

  it("returns null on unsupported platform", () => {
    setPlatform("freebsd")
    expect(getClipboardCmd()).toBeNull()
  })
})

// ── 2. getClipboardReadCmd() ─────────────────────────────────────────────
describe("getClipboardReadCmd", () => {
  afterEach(() => {
    restorePlatform()
    delete process.env.WSL_DISTRO_NAME
    delete process.env.WAYLAND_DISPLAY
  })

  it("returns pbpaste on darwin", () => {
    setPlatform("darwin")
    expect(getClipboardReadCmd()).toEqual({ cmd: "pbpaste", args: [] })
  })

  it("returns xclip -o on linux without WSL or Wayland", () => {
    setPlatform("linux")
    delete process.env.WSL_DISTRO_NAME
    delete process.env.WAYLAND_DISPLAY
    expect(getClipboardReadCmd()).toEqual({
      cmd: "xclip",
      args: ["-selection", "clipboard", "-o"],
    })
  })

  it("returns wl-paste on linux with WAYLAND_DISPLAY", () => {
    setPlatform("linux")
    delete process.env.WSL_DISTRO_NAME
    process.env.WAYLAND_DISPLAY = "wayland-0"
    expect(getClipboardReadCmd()).toEqual({
      cmd: "wl-paste",
      args: ["--no-newline"],
    })
  })

  it("returns powershell.exe Get-Clipboard on linux with WSL_DISTRO_NAME", () => {
    setPlatform("linux")
    process.env.WSL_DISTRO_NAME = "Ubuntu"
    expect(getClipboardReadCmd()).toEqual({
      cmd: "powershell.exe",
      args: ["-Command", "Get-Clipboard"],
    })
  })

  it("returns powershell.exe Get-Clipboard on win32", () => {
    setPlatform("win32")
    expect(getClipboardReadCmd()).toEqual({
      cmd: "powershell.exe",
      args: ["-Command", "Get-Clipboard"],
    })
  })

  it("returns null on unsupported platform", () => {
    setPlatform("freebsd")
    expect(getClipboardReadCmd()).toBeNull()
  })

  it("WSL takes priority over Wayland on linux", () => {
    setPlatform("linux")
    process.env.WSL_DISTRO_NAME = "Ubuntu"
    process.env.WAYLAND_DISPLAY = "wayland-0"
    // WSL check comes first in the source, so powershell.exe wins
    expect(getClipboardReadCmd()).toEqual({
      cmd: "powershell.exe",
      args: ["-Command", "Get-Clipboard"],
    })
  })
})

// ── 3. copyToClipboard() ────────────────────────────────────────────────
describe("copyToClipboard", () => {
  afterEach(() => {
    restorePlatform()
  })

  it("throws on unsupported platform", async () => {
    setPlatform("freebsd")
    await expect(copyToClipboard("hello")).rejects.toThrow(
      "Unsupported platform for clipboard access",
    )
  })

  it("successfully copies text via native command", async () => {
    // Only run on a platform where clipboard is available
    if (originalPlatform !== "darwin" && originalPlatform !== "linux") return
    restorePlatform()

    // Should not throw
    await copyToClipboard("clipboard-test-write")
  })
})

// ── 4. readClipboard() ──────────────────────────────────────────────────
describe("readClipboard", () => {
  afterEach(() => {
    restorePlatform()
  })

  it("throws on unsupported platform", async () => {
    setPlatform("freebsd")
    await expect(readClipboard()).rejects.toThrow(
      "Unsupported platform for clipboard read",
    )
  })

  it("returns a string from the clipboard", async () => {
    if (originalPlatform !== "darwin" && originalPlatform !== "linux") return
    restorePlatform()

    const result = await readClipboard()
    expect(typeof result).toBe("string")
  })
})

// ── 5. Round-trip integration ────────────────────────────────────────────
describe("copyToClipboard + readClipboard roundtrip", () => {
  afterEach(() => {
    restorePlatform()
  })

  it("writes and reads back the same text", async () => {
    if (originalPlatform !== "darwin" && originalPlatform !== "linux") return
    restorePlatform()

    const testText = `clipboard-test-${Date.now()}`
    await copyToClipboard(testText)
    const result = await readClipboard()
    expect(result.trim()).toBe(testText)
  })
})
