/**
 * Platform-specific clipboard read/write support.
 *
 * Write: getClipboardCmd() + copyToClipboard()
 * Read:  getClipboardReadCmd() + readClipboard()
 * Image: hasClipboardImage() + readClipboardImage()
 *
 * Uses native clipboard tools:
 *   macOS  → pbcopy / pbpaste / osascript
 *   Linux  → xclip -selection clipboard (or wl-paste for Wayland)
 *   WSL    → clip.exe / powershell Get-Clipboard
 */

import { log } from "./logger"
import { unlink } from "fs/promises"
import type { ImageContent } from "../protocol/types"

const IMAGE_MAX_BASE64_BYTES = 5 * 1024 * 1024
const CLIPBOARD_TIMEOUT_MS = 5_000

export function getClipboardCmd(): { cmd: string; args: string[] } | null {
  const platform = process.platform
  if (platform === "darwin") return { cmd: "pbcopy", args: [] }
  if (platform === "linux") {
    // WSL exposes clip.exe
    if (process.env.WSL_DISTRO_NAME) return { cmd: "clip.exe", args: [] }
    return { cmd: "xclip", args: ["-selection", "clipboard"] }
  }
  if (platform === "win32") return { cmd: "clip.exe", args: [] }
  return null
}

/** Returns the platform-specific command for reading from the system clipboard. */
export function getClipboardReadCmd(): { cmd: string; args: string[] } | null {
  const platform = process.platform
  if (platform === "darwin") return { cmd: "pbpaste", args: [] }
  if (platform === "linux") {
    if (process.env.WSL_DISTRO_NAME) {
      return { cmd: "powershell.exe", args: ["-Command", "Get-Clipboard"] }
    }
    if (process.env.WAYLAND_DISPLAY) {
      return { cmd: "wl-paste", args: ["--no-newline"] }
    }
    return { cmd: "xclip", args: ["-selection", "clipboard", "-o"] }
  }
  if (platform === "win32") {
    return { cmd: "powershell.exe", args: ["-Command", "Get-Clipboard"] }
  }
  return null
}

export async function copyToClipboard(text: string): Promise<void> {
  const clip = getClipboardCmd()
  if (!clip) throw new Error("Unsupported platform for clipboard access")

  const proc = Bun.spawn([clip.cmd, ...clip.args], {
    stdin: "pipe",
  })

  proc.stdin.write(text)
  proc.stdin.end()

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(`Clipboard command exited with code ${exitCode}`)
  }
}

/** Read text from the system clipboard. */
export async function readClipboard(): Promise<string> {
  const clip = getClipboardReadCmd()
  if (!clip) throw new Error("Unsupported platform for clipboard read")

  const proc = Bun.spawn([clip.cmd, ...clip.args], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(
      `Clipboard read command exited with code ${exitCode}: ${stderr.trim()}`,
    )
  }

  const text = await new Response(proc.stdout).text()
  return text
}

// ---------------------------------------------------------------------------
// Image clipboard support
// ---------------------------------------------------------------------------

type ClipboardPlatform = "darwin" | "linux-x11" | "linux-wayland" | "unsupported"

function detectPlatform(): ClipboardPlatform {
  const platform = process.platform
  if (platform === "darwin") return "darwin"
  if (platform === "linux") {
    if (process.env.WSL_DISTRO_NAME) return "unsupported"
    if (process.env.WAYLAND_DISPLAY) return "linux-wayland"
    return "linux-x11"
  }
  return "unsupported"
}

/** Spawn a process with a timeout. Returns null if spawn fails or times out. */
async function spawnWithTimeout(
  cmd: string[],
  opts?: { stdin?: "pipe" | "inherit"; stdout?: "pipe" | "inherit"; stderr?: "pipe" | "inherit" },
): Promise<{ exitCode: number; stdout: ReadableStream<Uint8Array>; stderr: ReadableStream<Uint8Array> } | null> {
  try {
    const proc = Bun.spawn(cmd, {
      stdin: opts?.stdin ?? "inherit",
      stdout: opts?.stdout ?? "pipe",
      stderr: opts?.stderr ?? "pipe",
    })

    const timeout = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), CLIPBOARD_TIMEOUT_MS),
    )

    const result = await Promise.race([proc.exited, timeout])
    if (result === "timeout") {
      proc.kill()
      log.warn("clipboard", `Command timed out after ${CLIPBOARD_TIMEOUT_MS}ms: ${cmd.join(" ")}`)
      return null
    }

    return {
      exitCode: result as number,
      stdout: proc.stdout as ReadableStream<Uint8Array>,
      stderr: proc.stderr as ReadableStream<Uint8Array>,
    }
  } catch (err) {
    log.warn("clipboard", `Failed to spawn command: ${cmd[0]}: ${err}`)
    return null
  }
}

/**
 * Detect whether the system clipboard contains image data.
 * Returns false on unsupported platforms or when no image is present.
 */
export async function hasClipboardImage(): Promise<boolean> {
  const plat = detectPlatform()

  if (plat === "unsupported") return false

  if (plat === "darwin") {
    const result = await spawnWithTimeout(
      ["osascript", "-e", "clipboard info"],
      { stdout: "pipe", stderr: "pipe" },
    )
    if (!result || result.exitCode !== 0) return false
    const output = await new Response(result.stdout).text()
    return output.includes("«class PNGf»")
  }

  if (plat === "linux-x11") {
    const result = await spawnWithTimeout(
      ["xclip", "-selection", "clipboard", "-t", "TARGETS", "-o"],
      { stdout: "pipe", stderr: "pipe" },
    )
    if (!result || result.exitCode !== 0) return false
    const output = await new Response(result.stdout).text()
    return /image\/(png|jpeg|jpg|gif|webp|bmp)/.test(output)
  }

  if (plat === "linux-wayland") {
    const result = await spawnWithTimeout(
      ["wl-paste", "--list-types"],
      { stdout: "pipe", stderr: "pipe" },
    )
    if (!result || result.exitCode !== 0) return false
    const output = await new Response(result.stdout).text()
    return /^image\//m.test(output)
  }

  return false
}

/**
 * Read image data from the system clipboard.
 * Returns base64-encoded image content, or null if no image is present
 * or on unsupported platforms.
 */
export async function readClipboardImage(): Promise<ImageContent | null> {
  const plat = detectPlatform()

  if (plat === "unsupported") return null

  if (plat === "darwin") {
    return readClipboardImageDarwin()
  }

  if (plat === "linux-x11") {
    return readClipboardImageLinuxX11()
  }

  if (plat === "linux-wayland") {
    return readClipboardImageLinuxWayland()
  }

  return null
}

async function readClipboardImageDarwin(): Promise<ImageContent | null> {
  const tmpPath = "/tmp/claude-opentui-clip.png"

  const result = await spawnWithTimeout(
    [
      "osascript",
      "-e", "set theImage to the clipboard as «class PNGf»",
      "-e", `set theFile to open for access POSIX file "${tmpPath}" with write permission`,
      "-e", "write theImage to theFile",
      "-e", "close access theFile",
    ],
    { stdout: "pipe", stderr: "pipe" },
  )

  if (!result || result.exitCode !== 0) {
    if (result) {
      const stderr = await new Response(result.stderr).text()
      log.warn("clipboard", `osascript image read failed (exit ${result.exitCode}): ${stderr.trim()}`)
    }
    return null
  }

  try {
    const arrayBuffer = await Bun.file(tmpPath).arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString("base64")

    if (base64.length > IMAGE_MAX_BASE64_BYTES) {
      log.warn("clipboard", `Clipboard image too large: ${base64.length} bytes base64 (limit ${IMAGE_MAX_BASE64_BYTES})`)
      return null
    }

    return { data: base64, mediaType: "image/png" }
  } catch (err) {
    log.warn("clipboard", `Failed to read temp image file: ${err}`)
    return null
  } finally {
    await unlink(tmpPath).catch(() => {})
  }
}

async function readClipboardImageLinuxX11(): Promise<ImageContent | null> {
  const result = await spawnWithTimeout(
    ["xclip", "-selection", "clipboard", "-t", "image/png", "-o"],
    { stdout: "pipe", stderr: "pipe" },
  )

  if (!result || result.exitCode !== 0) {
    if (result) {
      const stderr = await new Response(result.stderr).text()
      log.warn("clipboard", `xclip image read failed (exit ${result.exitCode}): ${stderr.trim()}`)
    }
    return null
  }

  return binaryStdoutToImageContent(result.stdout)
}

async function readClipboardImageLinuxWayland(): Promise<ImageContent | null> {
  const result = await spawnWithTimeout(
    ["wl-paste", "--type", "image/png"],
    { stdout: "pipe", stderr: "pipe" },
  )

  if (!result || result.exitCode !== 0) {
    if (result) {
      const stderr = await new Response(result.stderr).text()
      log.warn("clipboard", `wl-paste image read failed (exit ${result.exitCode}): ${stderr.trim()}`)
    }
    return null
  }

  return binaryStdoutToImageContent(result.stdout)
}

async function binaryStdoutToImageContent(
  stdout: ReadableStream<Uint8Array>,
): Promise<ImageContent | null> {
  try {
    const arrayBuffer = await new Response(stdout).arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString("base64")

    if (base64.length > IMAGE_MAX_BASE64_BYTES) {
      log.warn("clipboard", `Clipboard image too large: ${base64.length} bytes base64 (limit ${IMAGE_MAX_BASE64_BYTES})`)
      return null
    }

    return { data: base64, mediaType: "image/png" }
  } catch (err) {
    log.warn("clipboard", `Failed to read image from stdout: ${err}`)
    return null
  }
}
