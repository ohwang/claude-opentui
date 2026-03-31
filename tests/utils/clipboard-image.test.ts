import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test"
import type { ImageContent } from "../../src/protocol/types"

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

  it("returns null on unsupported platform (win32)", async () => {
    setPlatform("win32")
    const { readClipboardImage } = await importClipboard()
    const result = await readClipboardImage()
    expect(result).toBeNull()
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it("returns null on WSL (unsupported for image)", async () => {
    setPlatform("linux")
    process.env.WSL_DISTRO_NAME = "Ubuntu"
    const { readClipboardImage } = await importClipboard()
    const result = await readClipboardImage()
    expect(result).toBeNull()
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

    expect(result).not.toBeNull()
    expect(result!.mediaType).toBe("image/png")
    expect(result!.data).toBe(expectedBase64)
  })

  it("returns null when osascript fails (exit code 1) on macOS", async () => {
    setPlatform("darwin")
    spawnMock.mockReturnValue(
      fakeProc(1, "", "execution error: can't get clipboard") as any,
    )
    const { readClipboardImage } = await importClipboard()
    const result = await readClipboardImage()
    expect(result).toBeNull()
  })

  it("returns null when image exceeds 5MB limit on macOS", async () => {
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
    expect(result).toBeNull()
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

    expect(result).not.toBeNull()
    expect(result!.mediaType).toBe("image/png")
    expect(result!.data).toBe(Buffer.from(pngBytes).toString("base64"))
  })

  it("returns null when xclip fails on Linux X11", async () => {
    setPlatform("linux")
    delete process.env.WSL_DISTRO_NAME
    delete process.env.WAYLAND_DISPLAY

    spawnMock.mockReturnValue(
      fakeProc(1, "", "Error: target image/png not available") as any,
    )

    const { readClipboardImage } = await importClipboard()
    const result = await readClipboardImage()
    expect(result).toBeNull()
  })

  it("returns ImageContent on Linux Wayland via wl-paste", async () => {
    setPlatform("linux")
    delete process.env.WSL_DISTRO_NAME
    process.env.WAYLAND_DISPLAY = "wayland-0"

    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x04, 0x05, 0x06])

    spawnMock.mockReturnValue(fakeProc(0, pngBytes) as any)

    const { readClipboardImage } = await importClipboard()
    const result = await readClipboardImage()

    expect(result).not.toBeNull()
    expect(result!.mediaType).toBe("image/png")
    expect(result!.data).toBe(Buffer.from(pngBytes).toString("base64"))
  })

  it("returns null when wl-paste fails on Wayland", async () => {
    setPlatform("linux")
    delete process.env.WSL_DISTRO_NAME
    process.env.WAYLAND_DISPLAY = "wayland-0"

    spawnMock.mockReturnValue(
      fakeProc(1, "", "No suitable type of content copied") as any,
    )

    const { readClipboardImage } = await importClipboard()
    const result = await readClipboardImage()
    expect(result).toBeNull()
  })

  it("returns null when image exceeds 5MB limit via binary stdout (Linux)", async () => {
    setPlatform("linux")
    delete process.env.WSL_DISTRO_NAME
    delete process.env.WAYLAND_DISPLAY

    // ~4MB raw -> >5MB base64
    const oversized = new Uint8Array(4 * 1024 * 1024)
    spawnMock.mockReturnValue(fakeProc(0, oversized) as any)

    const { readClipboardImage } = await importClipboard()
    const result = await readClipboardImage()
    expect(result).toBeNull()
  })

  it("returns null when spawn throws (command not found)", async () => {
    setPlatform("darwin")
    spawnMock.mockImplementation(() => {
      throw new Error("spawn failed: command not found")
    })

    const { readClipboardImage } = await importClipboard()
    const result = await readClipboardImage()
    expect(result).toBeNull()
  })
})
