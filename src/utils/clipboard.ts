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
import { existsSync } from "node:fs"
import { readFile, unlink } from "node:fs/promises"
import { resolve } from "node:path"
import type { ImageContent } from "../protocol/types"

const IMAGE_MAX_BASE64_BYTES = 5 * 1024 * 1024
const CLIPBOARD_TIMEOUT_MS = 5_000
const IMAGE_EXTENSION_REGEX = /\.(png|jpe?g|gif|webp)$/i

type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp"

// ---------------------------------------------------------------------------
// Image format detection from magic bytes
// ---------------------------------------------------------------------------

/**
 * Detect image format from the first bytes of base64 data.
 * Falls back to image/png if format is unknown.
 */
export function detectImageFormatFromBase64(base64Data: string): ImageMediaType {
  try {
    const buffer = Buffer.from(base64Data.slice(0, 32), "base64")
    return detectImageFormatFromBuffer(buffer)
  } catch {
    return "image/png"
  }
}

function detectImageFormatFromBuffer(buffer: Buffer): ImageMediaType {
  if (buffer.length < 4) return "image/png"

  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png"
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg"
  }
  // GIF: 47 49 46 (GIF87a or GIF89a)
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return "image/gif"
  }
  // WebP: 52 49 46 46 ... 57 45 42 50
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer.length >= 12 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return "image/webp"
  }

  return "image/png"
}

// ---------------------------------------------------------------------------
// Image file path detection and reading
// ---------------------------------------------------------------------------

/**
 * Check if text looks like a path to an image file.
 */
export function isImageFilePath(text: string): boolean {
  const cleaned = removeOuterQuotes(text.trim())
  const unescaped = stripBackslashEscapes(cleaned)
  return IMAGE_EXTENSION_REGEX.test(unescaped)
}

/**
 * Read an image file from disk and return as ImageContent.
 * Returns null if the file doesn't exist, is too large, or can't be read.
 */
export async function readImageFile(filePath: string): Promise<ImageContent | null> {
  try {
    const cleaned = removeOuterQuotes(filePath.trim())
    const unescaped = stripBackslashEscapes(cleaned)
    const resolved = resolve(unescaped)

    if (!existsSync(resolved)) return null

    const buffer = await readFile(resolved)

    // Check size limit (5MB base64 ≈ 3.75MB raw)
    if (buffer.length > 3.75 * 1024 * 1024) {
      log.warn("Image file too large", { path: resolved, size: buffer.length })
      return null
    }

    const base64 = buffer.toString("base64")
    const mediaType = detectImageFormatFromBase64(base64)
    return { data: base64, mediaType }
  } catch (err) {
    log.warn("Failed to read image file", { path: filePath, error: String(err) })
    return null
  }
}

export function removeOuterQuotes(text: string): string {
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1)
  }
  return text
}

export function stripBackslashEscapes(path: string): string {
  if (process.platform === "win32") return path
  // Replace double backslashes with placeholder, remove single backslash escapes, restore
  const placeholder = "__DBL_BKSLASH__"
  return path
    .replace(/\\\\/g, placeholder)
    .replace(/\\(.)/g, "$1")
    .replace(new RegExp(placeholder, "g"), "\\")
}

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

    const mediaType = detectImageFormatFromBase64(base64)
    return { data: base64, mediaType }
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

    const mediaType = detectImageFormatFromBase64(base64)
    return { data: base64, mediaType }
  } catch (err) {
    log.warn("clipboard", `Failed to read image from stdout: ${err}`)
    return null
  }
}
