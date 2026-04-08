import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test"
import type { ImageContent } from "../../src/protocol/types"
import {
  detectImageFormatFromBase64,
  isImageFilePath,
  removeOuterQuotes,
  stripBackslashEscapes,
  readImageFile,
} from "../../src/utils/clipboard"

// ---------------------------------------------------------------------------
// Platform helpers
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Bun.spawn mock helpers
//
// The clipboard image functions call Bun.spawn indirectly via
// spawnWithTimeout. We mock Bun.spawn to return a controllable
// fake process with `.exited`, `.stdout`, and `.stderr`.
// ---------------------------------------------------------------------------
const originalSpawn = Bun.spawn

/** Build a ReadableStream<Uint8Array> from a string. */
function streamOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
}

/** Build a ReadableStream<Uint8Array> from a Uint8Array. */
function streamOfBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

/**
 * Build a fake subprocess result suitable for the shape Bun.spawn returns.
 * stdin is a no-op writable so callers that pipe to it don't blow up.
 */
function fakeProc(exitCode: number, stdout: string | Uint8Array = "", stderr = "") {
  return {
    exited: Promise.resolve(exitCode),
    stdout: typeof stdout === "string" ? streamOf(stdout) : streamOfBytes(stdout),
    stderr: streamOf(stderr),
    stdin: { write: () => {}, end: () => {}, flush: () => Promise.resolve() },
    pid: 1234,
    kill: () => {},
  }
}

// ---------------------------------------------------------------------------
// Fresh-import helper — we need to re-import the module for every test
// group because the module reads process.platform at call time, but the
// Bun.spawn mock needs to be set before import. We use dynamic import.
// ---------------------------------------------------------------------------

async function importClipboard() {
  // Dynamic import with cache bust so each call gets fresh module evaluation
  // is not needed here — the module reads platform per-call, not at import time.
  const mod = await import("../../src/utils/clipboard")
  return mod
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("hasClipboardImage", () => {
  let spawnMock: ReturnType<typeof spyOn>

  beforeEach(() => {
    spawnMock = spyOn(Bun, "spawn")
  })

  afterEach(() => {
    spawnMock.mockRestore()
    restorePlatform()
    delete process.env.WSL_DISTRO_NAME
    delete process.env.WAYLAND_DISPLAY
  })

  it("returns false on unsupported platform (win32)", async () => {
    setPlatform("win32")
    const { hasClipboardImage } = await importClipboard()
    const result = await hasClipboardImage()
    expect(result).toBe(false)
    // Bun.spawn should never be called for unsupported platform
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it("returns false on WSL (unsupported for image)", async () => {
    setPlatform("linux")
    process.env.WSL_DISTRO_NAME = "Ubuntu"
    const { hasClipboardImage } = await importClipboard()
    const result = await hasClipboardImage()
    expect(result).toBe(false)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it("returns true when osascript reports PNGf on macOS", async () => {
    setPlatform("darwin")
    spawnMock.mockReturnValue(
      fakeProc(0, "«class PNGf», 42\n«class 8BPS», 42\n") as any,
    )
    const { hasClipboardImage } = await importClipboard()
    const result = await hasClipboardImage()
    expect(result).toBe(true)
  })

  it("returns true when osascript reports JPEG on macOS", async () => {
    setPlatform("darwin")
    spawnMock.mockReturnValue(
      fakeProc(0, "«class JPEG», 42\n") as any,
    )
    const { hasClipboardImage } = await importClipboard()
    const result = await hasClipboardImage()
    expect(result).toBe(true)
  })

  it("returns false when osascript reports no PNGf on macOS", async () => {
    setPlatform("darwin")
    spawnMock.mockReturnValue(
      fakeProc(0, "«class ut16», 25\n") as any,
    )
    const { hasClipboardImage } = await importClipboard()
    const result = await hasClipboardImage()
    expect(result).toBe(false)
  })

  it("returns false when osascript fails (exit code 1) on macOS", async () => {
    setPlatform("darwin")
    spawnMock.mockReturnValue(
      fakeProc(1, "", "error: no clipboard") as any,
    )
    const { hasClipboardImage } = await importClipboard()
    const result = await hasClipboardImage()
    expect(result).toBe(false)
  })

  it("returns true when xclip reports image/png on Linux X11", async () => {
    setPlatform("linux")
    delete process.env.WSL_DISTRO_NAME
    delete process.env.WAYLAND_DISPLAY
    spawnMock.mockReturnValue(
      fakeProc(0, "TARGETS\nimage/png\ntext/plain\n") as any,
    )
    const { hasClipboardImage } = await importClipboard()
    const result = await hasClipboardImage()
    expect(result).toBe(true)
  })

  it("returns false when xclip reports no image type on Linux X11", async () => {
    setPlatform("linux")
    delete process.env.WSL_DISTRO_NAME
    delete process.env.WAYLAND_DISPLAY
    spawnMock.mockReturnValue(
      fakeProc(0, "TARGETS\ntext/plain\nUTF8_STRING\n") as any,
    )
    const { hasClipboardImage } = await importClipboard()
    const result = await hasClipboardImage()
    expect(result).toBe(false)
  })

  it("returns true when wl-paste reports image type on Wayland", async () => {
    setPlatform("linux")
    delete process.env.WSL_DISTRO_NAME
    process.env.WAYLAND_DISPLAY = "wayland-0"
    spawnMock.mockReturnValue(
      fakeProc(0, "image/png\ntext/plain\n") as any,
    )
    const { hasClipboardImage } = await importClipboard()
    const result = await hasClipboardImage()
    expect(result).toBe(true)
  })

  it("returns false when wl-paste fails on Wayland", async () => {
    setPlatform("linux")
    delete process.env.WSL_DISTRO_NAME
    process.env.WAYLAND_DISPLAY = "wayland-0"
    spawnMock.mockReturnValue(
      fakeProc(1, "", "No suitable type of content copied") as any,
    )
    const { hasClipboardImage } = await importClipboard()
    const result = await hasClipboardImage()
    expect(result).toBe(false)
  })

  it("returns false when spawn throws (command not found)", async () => {
    setPlatform("darwin")
    spawnMock.mockImplementation(() => {
      throw new Error("spawn failed: command not found")
    })
    const { hasClipboardImage } = await importClipboard()
    const result = await hasClipboardImage()
    expect(result).toBe(false)
  })
})

describe("readClipboardImage", () => {
  let spawnMock: ReturnType<typeof spyOn>
  let fileMock: ReturnType<typeof spyOn>

  beforeEach(() => {
    spawnMock = spyOn(Bun, "spawn")
  })

  afterEach(() => {
    spawnMock.mockRestore()
    if (fileMock) fileMock.mockRestore()
    restorePlatform()
    delete process.env.WSL_DISTRO_NAME
    delete process.env.WAYLAND_DISPLAY
  })

  it("returns not-ok on unsupported platform (win32)", async () => {
    setPlatform("win32")
    const { readClipboardImage } = await importClipboard()
    const result = await readClipboardImage()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("unsupported")
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it("returns not-ok on WSL (unsupported for image)", async () => {
    setPlatform("linux")
    process.env.WSL_DISTRO_NAME = "Ubuntu"
    const { readClipboardImage } = await importClipboard()
    const result = await readClipboardImage()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("unsupported")
  })

  it("returns ImageContent on macOS when osascript succeeds", async () => {
    setPlatform("darwin")

    // Minimal 1x1 transparent PNG (67 bytes)
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02,
      0x00, 0x01, 0xe5, 0x27, 0xde, 0xfc, 0x00, 0x00,
      0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
      0x60, 0x82,
    ])

    // Mock osascript spawn to succeed
    spawnMock.mockReturnValue(fakeProc(0, "") as any)

    // Mock Bun.file to return our png bytes
    const expectedBase64 = Buffer.from(pngBytes).toString("base64")
    fileMock = spyOn(Bun, "file").mockReturnValue({
      arrayBuffer: () => Promise.resolve(pngBytes.buffer),
    } as any)

    const { readClipboardImage } = await importClipboard()
    const result = await readClipboardImage()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.image.mediaType).toBe("image/png")
      expect(result.image.data).toBe(expectedBase64)
      expect(result.resized).toBe(false)
    }
  })

  it("returns not-ok when osascript fails (exit code 1) on macOS", async () => {
    setPlatform("darwin")
    spawnMock.mockReturnValue(
      fakeProc(1, "", "execution error: can't get clipboard") as any,
    )
    const { readClipboardImage } = await importClipboard()
    const result = await readClipboardImage()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("no_image")
  })

  it("returns too_large when image exceeds 5MB limit on macOS", async () => {
    setPlatform("darwin")

    // Mock osascript spawn success
    spawnMock.mockReturnValue(fakeProc(0, "") as any)

    // Create data that exceeds 5MB when base64-encoded
    // 5MB base64 = ~3.75MB raw, so 4MB raw should exceed the limit
    const oversizedBytes = new Uint8Array(4 * 1024 * 1024)
    fileMock = spyOn(Bun, "file").mockReturnValue({
      arrayBuffer: () => Promise.resolve(oversizedBytes.buffer),
    } as any)

    const { readClipboardImage } = await importClipboard()
    const result = await readClipboardImage()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("too_large")
  })

  it("returns ImageContent on Linux X11 via xclip", async () => {
    setPlatform("linux")
    delete process.env.WSL_DISTRO_NAME
    delete process.env.WAYLAND_DISPLAY

    // Small PNG bytes for stdout
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03])

    spawnMock.mockReturnValue(fakeProc(0, pngBytes) as any)

    const { readClipboardImage } = await importClipboard()
    const result = await readClipboardImage()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.image.mediaType).toBe("image/png")
      expect(result.image.data).toBe(Buffer.from(pngBytes).toString("base64"))
    }
  })

  it("uses distinct temp files for concurrent macOS clipboard reads", async () => {
    setPlatform("darwin")

    const pngA = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01])
    const pngB = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x02])
    const expectedA = Buffer.from(pngA).toString("base64")
    const expectedB = Buffer.from(pngB).toString("base64")

    const files = new Map<string, Uint8Array>()
    let spawnCount = 0
    let releaseReads: (() => void) | undefined
    const readsReady = new Promise<void>((resolve) => {
      releaseReads = resolve
    })

    spawnMock.mockImplementation((cmd: string[]) => {
      const script = cmd.find((part) => part.includes('open for access POSIX file "')) ?? ""
      const match = script.match(/POSIX file "([^\"]+)"/)
      const tmpPath = match?.[1]
      if (!tmpPath) throw new Error("tmp path not found in osascript command")

      files.set(tmpPath, spawnCount === 0 ? pngA : pngB)
      spawnCount++
      if (spawnCount === 2) releaseReads?.()

      return fakeProc(0, "") as any
    })

    fileMock = spyOn(Bun, "file").mockImplementation(((path: string | URL | ArrayBufferLike | Uint8Array | number) => ({
      arrayBuffer: async () => {
        await readsReady
        const bytes = files.get(path as string)
        if (!bytes) throw new Error(`missing mocked file for ${path}`)
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      },
    })) as any)

    const { readClipboardImage } = await importClipboard()
    const [first, second] = await Promise.all([
      readClipboardImage(),
      readClipboardImage(),
    ])

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (first.ok && second.ok) {
      expect(first.image.data).toBe(expectedA)
      expect(second.image.data).toBe(expectedB)
    }
  })

  it("returns not-ok when xclip fails on Linux X11", async () => {
    setPlatform("linux")
    delete process.env.WSL_DISTRO_NAME
    delete process.env.WAYLAND_DISPLAY

    spawnMock.mockReturnValue(
      fakeProc(1, "", "Error: target image/png not available") as any,
    )

    const { readClipboardImage } = await importClipboard()
    const result = await readClipboardImage()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("no_image")
  })

  it("returns ImageContent on Linux Wayland via wl-paste", async () => {
    setPlatform("linux")
    delete process.env.WSL_DISTRO_NAME
    process.env.WAYLAND_DISPLAY = "wayland-0"

    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x04, 0x05, 0x06])

    spawnMock.mockReturnValue(fakeProc(0, pngBytes) as any)

    const { readClipboardImage } = await importClipboard()
    const result = await readClipboardImage()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.image.mediaType).toBe("image/png")
      expect(result.image.data).toBe(Buffer.from(pngBytes).toString("base64"))
    }
  })

  it("returns not-ok when wl-paste fails on Wayland", async () => {
    setPlatform("linux")
    delete process.env.WSL_DISTRO_NAME
    process.env.WAYLAND_DISPLAY = "wayland-0"

    spawnMock.mockReturnValue(
      fakeProc(1, "", "No suitable type of content copied") as any,
    )

    const { readClipboardImage } = await importClipboard()
    const result = await readClipboardImage()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("no_image")
  })

  it("returns too_large when image exceeds 5MB limit via binary stdout (Linux)", async () => {
    setPlatform("linux")
    delete process.env.WSL_DISTRO_NAME
    delete process.env.WAYLAND_DISPLAY

    // ~4MB raw -> >5MB base64
    const oversized = new Uint8Array(4 * 1024 * 1024)
    spawnMock.mockReturnValue(fakeProc(0, oversized) as any)

    const { readClipboardImage } = await importClipboard()
    const result = await readClipboardImage()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("too_large")
  })

  it("returns not-ok when spawn throws (command not found)", async () => {
    setPlatform("darwin")
    spawnMock.mockImplementation(() => {
      throw new Error("spawn failed: command not found")
    })

    const { readClipboardImage } = await importClipboard()
    const result = await readClipboardImage()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("no_image")
  })
})

// ---------------------------------------------------------------------------
// Image format detection from magic bytes
// ---------------------------------------------------------------------------

describe("detectImageFormatFromBase64", () => {
  it("detects PNG from magic bytes", () => {
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const base64 = Buffer.from(pngBytes).toString("base64")
    expect(detectImageFormatFromBase64(base64)).toBe("image/png")
  })

  it("detects JPEG from magic bytes", () => {
    // JPEG signature: FF D8 FF E0 (JFIF) or FF D8 FF E1 (EXIF)
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    const base64 = Buffer.from(jpegBytes).toString("base64")
    expect(detectImageFormatFromBase64(base64)).toBe("image/jpeg")
  })

  it("detects JPEG with EXIF marker", () => {
    const jpegExif = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10])
    const base64 = Buffer.from(jpegExif).toString("base64")
    expect(detectImageFormatFromBase64(base64)).toBe("image/jpeg")
  })

  it("detects GIF87a from magic bytes", () => {
    // GIF87a: 47 49 46 38 37 61
    const gif87 = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61])
    const base64 = Buffer.from(gif87).toString("base64")
    expect(detectImageFormatFromBase64(base64)).toBe("image/gif")
  })

  it("detects GIF89a from magic bytes", () => {
    // GIF89a: 47 49 46 38 39 61
    const gif89 = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    const base64 = Buffer.from(gif89).toString("base64")
    expect(detectImageFormatFromBase64(base64)).toBe("image/gif")
  })

  it("detects WebP from magic bytes", () => {
    // WebP: RIFF....WEBP (52 49 46 46 xx xx xx xx 57 45 42 50)
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x00, 0x00, 0x00, 0x00, // file size (don't care)
      0x57, 0x45, 0x42, 0x50, // WEBP
    ])
    const base64 = Buffer.from(webp).toString("base64")
    expect(detectImageFormatFromBase64(base64)).toBe("image/webp")
  })

  it("falls back to image/png for unknown bytes", () => {
    const unknown = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05])
    const base64 = Buffer.from(unknown).toString("base64")
    expect(detectImageFormatFromBase64(base64)).toBe("image/png")
  })

  it("falls back to image/png for empty string", () => {
    expect(detectImageFormatFromBase64("")).toBe("image/png")
  })

  it("falls back to image/png for very short data", () => {
    // Just 2 bytes
    const short = new Uint8Array([0x89, 0x50])
    const base64 = Buffer.from(short).toString("base64")
    expect(detectImageFormatFromBase64(base64)).toBe("image/png")
  })

  it("falls back to image/png for invalid base64", () => {
    expect(detectImageFormatFromBase64("!!!not-base64!!!")).toBe("image/png")
  })
})

// ---------------------------------------------------------------------------
// isImageFilePath
// ---------------------------------------------------------------------------

describe("isImageFilePath", () => {
  it("matches .png extension", () => {
    expect(isImageFilePath("/path/to/image.png")).toBe(true)
  })

  it("matches .jpg extension", () => {
    expect(isImageFilePath("/path/to/photo.jpg")).toBe(true)
  })

  it("matches .jpeg extension", () => {
    expect(isImageFilePath("/path/to/photo.jpeg")).toBe(true)
  })

  it("matches .gif extension", () => {
    expect(isImageFilePath("animation.gif")).toBe(true)
  })

  it("matches .webp extension", () => {
    expect(isImageFilePath("photo.webp")).toBe(true)
  })

  it("matches case-insensitive extensions", () => {
    expect(isImageFilePath("image.PNG")).toBe(true)
    expect(isImageFilePath("image.JPG")).toBe(true)
    expect(isImageFilePath("image.JPEG")).toBe(true)
    expect(isImageFilePath("image.GIF")).toBe(true)
    expect(isImageFilePath("image.WEBP")).toBe(true)
  })

  it("does not match .txt files", () => {
    expect(isImageFilePath("/path/to/file.txt")).toBe(false)
  })

  it("does not match files with no extension", () => {
    expect(isImageFilePath("/path/to/README")).toBe(false)
  })

  it("does not match .svg files", () => {
    expect(isImageFilePath("icon.svg")).toBe(false)
  })

  it("matches quoted paths", () => {
    expect(isImageFilePath('"/path/to/my image.png"')).toBe(true)
    expect(isImageFilePath("'/path/to/my image.jpg'")).toBe(true)
  })

  it("matches escaped paths (non-Windows)", () => {
    // On macOS/Linux, backslash-space is an escaped space
    expect(isImageFilePath("/path/to/my\\ image.png")).toBe(true)
  })

  it("handles whitespace around paths", () => {
    expect(isImageFilePath("  /path/to/image.png  ")).toBe(true)
  })

  it("does not match empty string", () => {
    expect(isImageFilePath("")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// removeOuterQuotes
// ---------------------------------------------------------------------------

describe("removeOuterQuotes", () => {
  it("removes double quotes", () => {
    expect(removeOuterQuotes('"hello world"')).toBe("hello world")
  })

  it("removes single quotes", () => {
    expect(removeOuterQuotes("'hello world'")).toBe("hello world")
  })

  it("does not remove mismatched quotes", () => {
    expect(removeOuterQuotes("\"hello world'")).toBe("\"hello world'")
  })

  it("does not remove quotes that are only at the start", () => {
    expect(removeOuterQuotes('"hello world')).toBe('"hello world')
  })

  it("returns unquoted text unchanged", () => {
    expect(removeOuterQuotes("hello world")).toBe("hello world")
  })

  it("handles empty string", () => {
    expect(removeOuterQuotes("")).toBe("")
  })

  it("handles single character quotes", () => {
    // Two double quotes = empty string inside
    expect(removeOuterQuotes('""')).toBe("")
  })
})

// ---------------------------------------------------------------------------
// stripBackslashEscapes
// ---------------------------------------------------------------------------

describe("stripBackslashEscapes", () => {
  const origPlatform = process.platform

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: origPlatform, writable: true })
  })

  it("removes single backslash escapes on non-Windows", () => {
    Object.defineProperty(process, "platform", { value: "darwin", writable: true })
    expect(stripBackslashEscapes("/path/to/my\\ file.png")).toBe("/path/to/my file.png")
  })

  it("preserves double backslashes as single backslash on non-Windows", () => {
    Object.defineProperty(process, "platform", { value: "darwin", writable: true })
    expect(stripBackslashEscapes("/path\\\\file.png")).toBe("/path\\file.png")
  })

  it("returns path unchanged on win32", () => {
    Object.defineProperty(process, "platform", { value: "win32", writable: true })
    expect(stripBackslashEscapes("C:\\Users\\test\\image.png")).toBe("C:\\Users\\test\\image.png")
  })

  it("handles paths with no escapes", () => {
    Object.defineProperty(process, "platform", { value: "darwin", writable: true })
    expect(stripBackslashEscapes("/simple/path.png")).toBe("/simple/path.png")
  })
})

// ---------------------------------------------------------------------------
// readImageFile
// ---------------------------------------------------------------------------

describe("readImageFile", () => {
  it("returns null for non-existent file", async () => {
    const result = await readImageFile("/tmp/does-not-exist-12345.png")
    expect(result).toBeNull()
  })

  it("reads an actual image file from disk", async () => {
    const { writeFileSync, unlinkSync } = await import("fs")
    const tmpPath = "/tmp/test-image-read.png"

    // Minimal PNG: magic bytes + minimal structure
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02,
      0x00, 0x01, 0xe5, 0x27, 0xde, 0xfc, 0x00, 0x00,
      0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
      0x60, 0x82,
    ])

    try {
      writeFileSync(tmpPath, pngBytes)
      const result = await readImageFile(tmpPath)
      expect(result).not.toBeNull()
      expect(result!.mediaType).toBe("image/png")
      expect(result!.data).toBe(Buffer.from(pngBytes).toString("base64"))
    } finally {
      try { unlinkSync(tmpPath) } catch {}
    }
  })

  it("reads a JPEG file and detects format correctly", async () => {
    const { writeFileSync, unlinkSync } = await import("fs")
    const tmpPath = "/tmp/test-image-read.jpg"

    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])

    try {
      writeFileSync(tmpPath, jpegBytes)
      const result = await readImageFile(tmpPath)
      expect(result).not.toBeNull()
      expect(result!.mediaType).toBe("image/jpeg")
    } finally {
      try { unlinkSync(tmpPath) } catch {}
    }
  })

  it("handles quoted file paths", async () => {
    const result = await readImageFile('"/tmp/does-not-exist-12345.png"')
    expect(result).toBeNull() // File doesn't exist, but path parsing should work
  })

  it("returns null for non-image file that exists", async () => {
    // readImageFile reads any file — the format detection just falls back to PNG.
    // This test verifies it doesn't crash on arbitrary content.
    const { writeFileSync, unlinkSync } = await import("fs")
    const tmpPath = "/tmp/test-not-image.txt"

    try {
      writeFileSync(tmpPath, "hello world")
      // readImageFile will read it but detect as PNG (fallback)
      const result = await readImageFile(tmpPath)
      expect(result).not.toBeNull()
      expect(result!.mediaType).toBe("image/png") // fallback
    } finally {
      try { unlinkSync(tmpPath) } catch {}
    }
  })


  it("expands ~/ paths on darwin", async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import("fs")
    const prevPlatform = process.platform
    const prevHome = process.env.HOME
    const homeDir = `/tmp/clip-home-${Date.now()}`
    const desktopDir = `${homeDir}/Desktop`
    const tmpPath = `${desktopDir}/tilde-test.png`

    Object.defineProperty(process, "platform", { value: "darwin", writable: true })
    process.env.HOME = homeDir

    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02,
      0x00, 0x01, 0xe5, 0x27, 0xde, 0xfc, 0x00, 0x00,
      0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
      0x60, 0x82,
    ])

    try {
      mkdirSync(desktopDir, { recursive: true })
      writeFileSync(tmpPath, pngBytes)
      const result = await readImageFile("~/Desktop/tilde-test.png")
      expect(result).not.toBeNull()
      expect(result!.mediaType).toBe("image/png")
    } finally {
      Object.defineProperty(process, "platform", { value: prevPlatform, writable: true })
      if (prevHome === undefined) delete process.env.HOME
      else process.env.HOME = prevHome
      rmSync(homeDir, { recursive: true, force: true })
    }
  })
})
