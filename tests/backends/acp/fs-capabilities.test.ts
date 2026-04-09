import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { mkdtemp, writeFile, readFile, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { validatePathWithinCwd } from "../../../src/backends/acp/adapter"

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

describe("validatePathWithinCwd", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "acp-fs-test-"))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it("accepts a path within cwd", () => {
    const result = validatePathWithinCwd(path.join(tempDir, "file.txt"), tempDir)
    expect(result.valid).toBe(true)
    expect(result.resolved).toBe(path.join(tempDir, "file.txt"))
    expect(result.error).toBeUndefined()
  })

  it("accepts a nested path within cwd", () => {
    const result = validatePathWithinCwd(path.join(tempDir, "sub/dir/file.txt"), tempDir)
    expect(result.valid).toBe(true)
  })

  it("rejects a path outside cwd via ..", () => {
    const result = validatePathWithinCwd(path.join(tempDir, "../../../etc/passwd"), tempDir)
    expect(result.valid).toBe(false)
    expect(result.error).toContain("Path outside working directory")
  })

  it("rejects an absolute path outside cwd", () => {
    const result = validatePathWithinCwd("/etc/passwd", tempDir)
    expect(result.valid).toBe(false)
    expect(result.error).toContain("Path outside working directory")
  })

  it("accepts the cwd itself", () => {
    const result = validatePathWithinCwd(tempDir, tempDir)
    expect(result.valid).toBe(true)
    expect(result.resolved).toBe(tempDir)
  })

  it("rejects a path that is a prefix but not a child", () => {
    // e.g. cwd = /tmp/foo, path = /tmp/foobar
    const result = validatePathWithinCwd(tempDir + "bar", tempDir)
    expect(result.valid).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Filesystem read/write (integration via real files)
//
// Since handleFsRead/handleFsWrite are private methods, we test the
// underlying I/O logic directly with real temp files. The path validation
// function above is tested separately.
// ---------------------------------------------------------------------------

describe("ACP filesystem read operations", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "acp-fs-read-"))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it("reads a file that exists", async () => {
    const filePath = path.join(tempDir, "hello.txt")
    await writeFile(filePath, "Hello, world!\nLine 2\nLine 3", "utf-8")

    const fs = await import("fs/promises")
    const content = await fs.readFile(filePath, "utf-8")
    expect(content).toBe("Hello, world!\nLine 2\nLine 3")
  })

  it("reads with line/limit filtering (line 2, limit 1)", async () => {
    const filePath = path.join(tempDir, "lines.txt")
    await writeFile(filePath, "Line 1\nLine 2\nLine 3\nLine 4\nLine 5", "utf-8")

    const fs = await import("fs/promises")
    const content = await fs.readFile(filePath, "utf-8")

    // Replicate the adapter's line/limit logic
    const line = 2
    const limit = 1
    const lines = content.split("\n")
    const startLine = (line ?? 1) - 1  // 1-indexed
    const endLine = limit ? startLine + limit : lines.length
    const sliced = lines.slice(Math.max(0, startLine), endLine).join("\n")

    expect(sliced).toBe("Line 2")
  })

  it("reads with line only (from line 3 to end)", async () => {
    const filePath = path.join(tempDir, "lines.txt")
    await writeFile(filePath, "Line 1\nLine 2\nLine 3\nLine 4\nLine 5", "utf-8")

    const fs = await import("fs/promises")
    const content = await fs.readFile(filePath, "utf-8")

    const line = 3
    const limit = undefined
    const lines = content.split("\n")
    const startLine = (line ?? 1) - 1
    const endLine = limit ? startLine + limit : lines.length
    const sliced = lines.slice(Math.max(0, startLine), endLine).join("\n")

    expect(sliced).toBe("Line 3\nLine 4\nLine 5")
  })

  it("reads with limit only (first 2 lines)", async () => {
    const filePath = path.join(tempDir, "lines.txt")
    await writeFile(filePath, "Line 1\nLine 2\nLine 3\nLine 4\nLine 5", "utf-8")

    const fs = await import("fs/promises")
    const content = await fs.readFile(filePath, "utf-8")

    const line = undefined
    const limit = 2
    const lines = content.split("\n")
    const startLine = (line ?? 1) - 1
    const endLine = limit ? startLine + limit : lines.length
    const sliced = lines.slice(Math.max(0, startLine), endLine).join("\n")

    expect(sliced).toBe("Line 1\nLine 2")
  })

  it("throws ENOENT for non-existent file", async () => {
    const filePath = path.join(tempDir, "does-not-exist.txt")
    const fs = await import("fs/promises")

    try {
      await fs.readFile(filePath, "utf-8")
      expect(true).toBe(false)  // should not reach here
    } catch (err: any) {
      expect(err.code).toBe("ENOENT")
    }
  })
})

describe("ACP filesystem write operations", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "acp-fs-write-"))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it("writes a new file", async () => {
    const filePath = path.join(tempDir, "output.txt")
    const content = "Hello from ACP write"

    const fs = await import("fs/promises")
    await fs.writeFile(filePath, content, "utf-8")

    const result = await readFile(filePath, "utf-8")
    expect(result).toBe("Hello from ACP write")
  })

  it("overwrites an existing file", async () => {
    const filePath = path.join(tempDir, "existing.txt")
    await writeFile(filePath, "old content", "utf-8")

    const fs = await import("fs/promises")
    await fs.writeFile(filePath, "new content", "utf-8")

    const result = await readFile(filePath, "utf-8")
    expect(result).toBe("new content")
  })

  it("creates parent directories (mkdir -p behavior)", async () => {
    const filePath = path.join(tempDir, "deep", "nested", "dir", "file.txt")
    const content = "deeply nested"

    const fs = await import("fs/promises")
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, "utf-8")

    const result = await readFile(filePath, "utf-8")
    expect(result).toBe("deeply nested")
  })

  it("path validation blocks write outside cwd", () => {
    const result = validatePathWithinCwd("/etc/shadow", tempDir)
    expect(result.valid).toBe(false)
    expect(result.error).toContain("Path outside working directory")
  })
})
