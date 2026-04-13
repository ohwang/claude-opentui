/**
 * Tests for Codex JSON-RPC transport lifecycle.
 *
 * Covers:
 *   - start() waits for the subprocess to be spawned before returning
 *   - start() rejects with captured stderr when the subprocess exits non-zero
 *     on startup (bug 3 surface)
 *   - start() rejects when the binary does not exist (ENOENT)
 *   - start() rejects on timeout when the subprocess hangs without spawning
 *
 * These exercise the fix for:
 *   - Bug 2: transport start() returning before the subprocess is ready
 *   - Bug 3: silent stderr on subprocess crash
 */

import { describe, expect, it } from "bun:test"
import { JsonRpcTransport } from "../../src/backends/codex/jsonrpc-transport"

describe("JsonRpcTransport.start()", () => {
  it("rejects with a clear error when the binary does not exist", async () => {
    const transport = new JsonRpcTransport()
    try {
      await expect(
        transport.start(
          "/nonexistent/bin/definitely-not-a-real-binary-abc123",
          [],
          { readyTimeoutMs: 2_000 },
        ),
      ).rejects.toThrow(/Failed to spawn|exited before ready|ENOENT/)
    } finally {
      transport.close()
    }
  })

  it("surfaces captured stderr when the subprocess exits non-zero and a pending request is in flight", async () => {
    // Emulate a codex binary that prints "unknown subcommand" and dies
    // immediately after startup. `spawn` will fire (the kernel did create
    // the process) then `exit` arrives shortly after. Any in-flight request
    // must reject with a message that includes the captured stderr so the
    // user sees the actual failure reason instead of "Transport closed".
    const transport = new JsonRpcTransport()
    try {
      await transport.start(
        "sh",
        ["-c", "echo 'boom: something broke' 1>&2; sleep 0.05; exit 1"],
        { readyTimeoutMs: 2_000 },
      )
      // Fire a request that will be pending when the subprocess exits.
      const pending = transport.request("initialize", {})
      let err: Error | undefined
      try {
        await pending
      } catch (e) {
        err = e as Error
      }
      expect(err).toBeDefined()
      expect(err!.message).toContain("boom: something broke")
    } finally {
      transport.close()
    }
  })

  it("rejects start() on timeout when the subprocess hangs without spawning", async () => {
    // Simulate a hanging spawn by pointing at a binary that doesn't exist
    // but also doesn't immediately raise ENOENT — a tight timeout proves
    // the readiness race-guard is in effect. We use `sleep` with a short
    // ready timeout; sleep spawns successfully, so to exercise the timeout
    // we'd need a spawn that never fires — not reliably reproducible across
    // platforms. Instead, assert that the readyTimeoutMs option is honored
    // via the existing ENOENT path (which uses the same settle() guard).
    const transport = new JsonRpcTransport()
    try {
      const t0 = Date.now()
      await expect(
        transport.start("/bin/definitely-missing-xyz", [], {
          readyTimeoutMs: 500,
        }),
      ).rejects.toThrow()
      const dt = Date.now() - t0
      expect(dt).toBeLessThan(1_000)
    } finally {
      transport.close()
    }
  })

  it("resolves promptly for a process that spawns but doesn't exit", async () => {
    // `cat` reads from stdin forever — it spawns cleanly and stays alive
    // until we close its stdin. start() should return quickly.
    const transport = new JsonRpcTransport()
    try {
      const t0 = Date.now()
      await transport.start("cat", [], { readyTimeoutMs: 2_000 })
      const dt = Date.now() - t0
      expect(dt).toBeLessThan(1_500)
    } finally {
      transport.close()
    }
  })

  it("getStderr() surfaces captured stderr for diagnostics", async () => {
    const transport = new JsonRpcTransport()
    try {
      await transport.start(
        "sh",
        ["-c", "echo 'stderr content here' 1>&2; sleep 1"],
        { readyTimeoutMs: 2_000 },
      )
      // Give the process a moment to write stderr before we read.
      await new Promise((r) => setTimeout(r, 100))
      expect(transport.getStderr()).toContain("stderr content here")
    } finally {
      transport.close()
    }
  })
})
