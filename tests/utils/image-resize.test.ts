import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test"

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
// Bun.spawn / Bun.write / Bun.file mock helpers
// ---------------------------------------------------------------------------

function streamOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
}

function fakeProc(exitCode: number, stdout: string = "", stderr = "") {
  return {
    exited: Promise.resolve(exitCode),
    stdout: streamOf(stdout),
    stderr: streamOf(stderr),
    stdin: { write: () => {}, end: () => {}, flush: () => Promise.resolve() },
    pid: 1234,
    kill: () => {},
  }
}

async function importClipboard() {
  return await import("../../src/utils/clipboard")
}

// ---------------------------------------------------------------------------
// Tests: maybeResizeImage
// ---------------------------------------------------------------------------

describe("maybeResizeImage", () => {
  let spawnMock: ReturnType<typeof spyOn>
  let writeMock: ReturnType<typeof spyOn>
  let fileMock: ReturnType<typeof spyOn>

  beforeEach(() => {
    spawnMock = spyOn(Bun, "spawn")
    writeMock = spyOn(Bun, "write").mockResolvedValue(0 as any)
  })

  afterEach(() => {
    spawnMock.mockRestore()
    writeMock.mockRestore()
    if (fileMock) fileMock.mockRestore()
    restorePlatform()
    delete process.env.WSL_DISTRO_NAME
    delete process.env.WAYLAND_DISPLAY
  })

  it("returns original buffer when under size limit (no resize needed)", async () => {
    const { maybeResizeImage } = await importClipboard()
    // 1KB buffer — well under the 3.75MB limit
    const smallBuffer = Buffer.alloc(1024, 0x42)
    const result = await maybeResizeImage(smallBuffer, "image/png")

    expect(result.resized).toBe(false)
    expect(result.buffer).toBe(smallBuffer)
    expect(result.mediaType).toBe("image/png")
    // Bun.spawn should never be called for small images
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it("attempts sips resize on macOS for oversized image", async () => {
    setPlatform("darwin")
    const { maybeResizeImage } = await importClipboard()

    // 4MB buffer — exceeds the 3.75MB raw limit
    const largeBuffer = Buffer.alloc(4 * 1024 * 1024, 0x42)
    // Smaller result from sips
    const resizedBytes = new Uint8Array(500_000)

    spawnMock.mockReturnValue(fakeProc(0, "") as any)
    fileMock = spyOn(Bun, "file").mockReturnValue({
      arrayBuffer: () => Promise.resolve(resizedBytes.buffer),
    } as any)

    const result = await maybeResizeImage(largeBuffer, "image/png")

    expect(result.resized).toBe(true)
    expect(result.mediaType).toBe("image/jpeg")
    expect(result.buffer.length).toBe(500_000)
    // sips should have been called
    expect(spawnMock).toHaveBeenCalled()
    const spawnArgs = spawnMock.mock.calls[0][0] as string[]
    expect(spawnArgs[0]).toBe("sips")
  })

  it("attempts convert resize on Linux for oversized image", async () => {
    setPlatform("linux")
    delete process.env.WSL_DISTRO_NAME
    delete process.env.WAYLAND_DISPLAY
    const { maybeResizeImage } = await importClipboard()

    const largeBuffer = Buffer.alloc(4 * 1024 * 1024, 0x42)
    const resizedBytes = new Uint8Array(600_000)

    spawnMock.mockReturnValue(fakeProc(0, "") as any)
    fileMock = spyOn(Bun, "file").mockReturnValue({
      arrayBuffer: () => Promise.resolve(resizedBytes.buffer),
    } as any)

    const result = await maybeResizeImage(largeBuffer, "image/png")

    expect(result.resized).toBe(true)
    expect(result.mediaType).toBe("image/jpeg")
    expect(result.buffer.length).toBe(600_000)
    const spawnArgs = spawnMock.mock.calls[0][0] as string[]
    expect(spawnArgs[0]).toBe("convert")
  })

  it("returns original buffer on unsupported platform even if oversized", async () => {
    setPlatform("win32")
    const { maybeResizeImage } = await importClipboard()

    const largeBuffer = Buffer.alloc(4 * 1024 * 1024, 0x42)
    const result = await maybeResizeImage(largeBuffer, "image/png")

    expect(result.resized).toBe(false)
    expect(result.buffer).toBe(largeBuffer)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it("returns original buffer when sips produces larger output", async () => {
    setPlatform("darwin")
    const { maybeResizeImage } = await importClipboard()

    const largeBuffer = Buffer.alloc(4 * 1024 * 1024, 0x42)
    // Simulate sips producing an even larger file (unlikely but edge case)
    const biggerBytes = new Uint8Array(5 * 1024 * 1024)

    spawnMock.mockReturnValue(fakeProc(0, "") as any)
    fileMock = spyOn(Bun, "file").mockReturnValue({
      arrayBuffer: () => Promise.resolve(biggerBytes.buffer),
    } as any)

    const result = await maybeResizeImage(largeBuffer, "image/png")

    expect(result.resized).toBe(false)
    expect(result.buffer).toBe(largeBuffer)
    expect(result.mediaType).toBe("image/png")
  })

  it("returns original buffer when sips throws", async () => {
    setPlatform("darwin")
    const { maybeResizeImage } = await importClipboard()

    const largeBuffer = Buffer.alloc(4 * 1024 * 1024, 0x42)

    spawnMock.mockImplementation(() => {
      throw new Error("sips not found")
    })

    const result = await maybeResizeImage(largeBuffer, "image/png")

    expect(result.resized).toBe(false)
    expect(result.buffer).toBe(largeBuffer)
  })

  it("returns original buffer when convert throws", async () => {
    setPlatform("linux")
    delete process.env.WSL_DISTRO_NAME
    delete process.env.WAYLAND_DISPLAY
    const { maybeResizeImage } = await importClipboard()

    const largeBuffer = Buffer.alloc(4 * 1024 * 1024, 0x42)

    spawnMock.mockImplementation(() => {
      throw new Error("convert not found")
    })

    const result = await maybeResizeImage(largeBuffer, "image/png")

    expect(result.resized).toBe(false)
    expect(result.buffer).toBe(largeBuffer)
  })
})

// ---------------------------------------------------------------------------
// Tests: readClipboardImage with resize integration
// ---------------------------------------------------------------------------

describe("readClipboardImage — resize integration", () => {
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

  it("returns too_large when image exceeds limit even after resize attempt on macOS", async () => {
    setPlatform("darwin")

    // First call: osascript succeeds
    // Second call: sips resize (but still too large)
    let callCount = 0
    spawnMock.mockImplementation(() => {
      callCount++
      return fakeProc(0, "") as any
    })

    // 4MB raw data that stays 4MB after "resize" (simulating failed compression)
    const oversizedBytes = new Uint8Array(4 * 1024 * 1024)
    const writeMock = spyOn(Bun, "write").mockResolvedValue(0 as any)
    fileMock = spyOn(Bun, "file").mockReturnValue({
      arrayBuffer: () => Promise.resolve(oversizedBytes.buffer),
    } as any)

    const { readClipboardImage } = await importClipboard()
    const result = await readClipboardImage()

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("too_large")
    }

    writeMock.mockRestore()
  })

  it("returns ok with resized=true when image was successfully downscaled via stdout (Linux)", async () => {
    setPlatform("linux")
    delete process.env.WSL_DISTRO_NAME
    delete process.env.WAYLAND_DISPLAY

    // Small PNG bytes (under 3.75MB) — no resize needed
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03])
    const pngStream = new ReadableStream({
      start(controller) {
        controller.enqueue(pngBytes)
        controller.close()
      },
    })

    spawnMock.mockReturnValue({
      exited: Promise.resolve(0),
      stdout: pngStream,
      stderr: streamOf(""),
      stdin: { write: () => {}, end: () => {}, flush: () => Promise.resolve() },
      pid: 1234,
      kill: () => {},
    } as any)

    const { readClipboardImage } = await importClipboard()
    const result = await readClipboardImage()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.resized).toBe(false)
      expect(result.image.mediaType).toBe("image/png")
      expect(result.image.data).toBe(Buffer.from(pngBytes).toString("base64"))
    }
  })
})

// ---------------------------------------------------------------------------
// Tests: ClipboardImageResult discriminated union
// ---------------------------------------------------------------------------

describe("ClipboardImageResult union", () => {
  let spawnMock: ReturnType<typeof spyOn>

  beforeEach(() => {
    spawnMock = spyOn(Bun, "spawn")
  })

  afterEach(() => {
    spawnMock.mockRestore()
    restorePlatform()
    delete process.env.WSL_DISTRO_NAME
  })

  it("returns unsupported reason on win32", async () => {
    setPlatform("win32")
    const { readClipboardImage } = await importClipboard()
    const result = await readClipboardImage()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("unsupported")
    }
  })

  it("returns no_image reason when osascript fails on macOS", async () => {
    setPlatform("darwin")
    spawnMock.mockReturnValue(fakeProc(1, "", "no clipboard image") as any)
    const { readClipboardImage } = await importClipboard()
    const result = await readClipboardImage()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("no_image")
    }
  })
})
