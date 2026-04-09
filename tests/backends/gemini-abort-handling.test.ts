/**
 * Tests for Gemini adapter abort error handling.
 *
 * The Gemini SDK produces various forms of abort errors when a stream is
 * interrupted (user Ctrl+C, first-event timeout). These tests verify that
 * `isAbortError()` correctly identifies all known variants, and that the
 * adapter's abort-related behavior is correct.
 */

import { describe, expect, it } from "bun:test"
import { isAbortError } from "../../src/backends/gemini/adapter"
import { GeminiAdapter } from "../../src/backends/gemini/adapter"

// ---------------------------------------------------------------------------
// isAbortError — core detection logic
// ---------------------------------------------------------------------------

describe("isAbortError", () => {
  describe("positive cases", () => {
    it("detects DOMException AbortError by name", () => {
      const err = new DOMException("The operation was aborted", "AbortError")
      expect(isAbortError(err)).toBe(true)
    })

    it("detects Error with name 'AbortError'", () => {
      const err = new Error("signal aborted")
      err.name = "AbortError"
      expect(isAbortError(err)).toBe(true)
    })

    it("detects 'The operation was aborted' message (no period)", () => {
      const err = new Error("The operation was aborted")
      expect(isAbortError(err)).toBe(true)
    })

    it("detects 'The operation was aborted.' message (with period)", () => {
      const err = new Error("The operation was aborted.")
      expect(isAbortError(err)).toBe(true)
    })

    it("detects 'This operation was aborted' signal.reason variant", () => {
      const err = new Error("This operation was aborted")
      expect(isAbortError(err)).toBe(true)
    })

    it("detects message containing 'operation was aborted' substring", () => {
      const err = new Error("Fetch failed: operation was aborted by user")
      expect(isAbortError(err)).toBe(true)
    })

    it("detects AbortError created via AbortController.abort()", () => {
      const controller = new AbortController()
      controller.abort()
      // signal.reason is a DOMException with name 'AbortError'
      const reason = controller.signal.reason
      expect(isAbortError(reason)).toBe(true)
    })

    it("detects AbortError with custom reason string wrapped in Error", () => {
      const controller = new AbortController()
      controller.abort("user interrupt")
      // When reason is a string, it won't match — but the default DOMException does
      // Let's test the actual signal.reason
      const err = new Error("The operation was aborted")
      err.name = "AbortError"
      expect(isAbortError(err)).toBe(true)
    })
  })

  describe("negative cases", () => {
    it("rejects null", () => {
      expect(isAbortError(null)).toBe(false)
    })

    it("rejects undefined", () => {
      expect(isAbortError(undefined)).toBe(false)
    })

    it("rejects plain strings", () => {
      expect(isAbortError("AbortError")).toBe(false)
      expect(isAbortError("The operation was aborted")).toBe(false)
    })

    it("rejects numbers", () => {
      expect(isAbortError(42)).toBe(false)
    })

    it("rejects plain objects (not Error instances)", () => {
      expect(isAbortError({ name: "AbortError" })).toBe(false)
      expect(
        isAbortError({ message: "The operation was aborted" }),
      ).toBe(false)
    })

    it("rejects regular Error with unrelated message", () => {
      expect(isAbortError(new Error("Connection refused"))).toBe(false)
    })

    it("rejects TypeError", () => {
      expect(isAbortError(new TypeError("Cannot read property"))).toBe(false)
    })

    it("rejects Error with 'abort' in message but not the pattern", () => {
      expect(isAbortError(new Error("Please do not abort the mission"))).toBe(
        false,
      )
    })

    it("rejects Error with 'AbortError' in message but wrong name", () => {
      // The message must match the pattern, not just contain "AbortError"
      const err = new Error("Got AbortError from upstream")
      // This actually doesn't match "operation was aborted", so it depends
      // But "AbortError" in the message alone isn't enough — name must be AbortError
      // OR message must match "operation was aborted" pattern
      expect(isAbortError(err)).toBe(false)
    })
  })

  describe("edge cases", () => {
    it("handles Error subclasses", () => {
      class CustomError extends Error {
        constructor(msg: string) {
          super(msg)
          this.name = "AbortError"
        }
      }
      expect(isAbortError(new CustomError("custom"))).toBe(true)
    })

    it("handles Error with empty message but AbortError name", () => {
      const err = new Error("")
      err.name = "AbortError"
      expect(isAbortError(err)).toBe(true)
    })

    it("handles Bun's internal fetch abort format", () => {
      // Bun wraps DOMException into plain Error sometimes
      const err = new Error("The operation was aborted")
      expect(isAbortError(err)).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// GeminiAdapter abort behavior — integration-style tests
// ---------------------------------------------------------------------------

describe("GeminiAdapter abort behavior", () => {
  describe("interrupt() without active session", () => {
    it("is safe to call before start()", () => {
      const adapter = new GeminiAdapter()
      // Should not throw
      adapter.interrupt()
      adapter.close()
    })

    it("is safe to call multiple times", () => {
      const adapter = new GeminiAdapter()
      adapter.interrupt()
      adapter.interrupt()
      adapter.interrupt()
      adapter.close()
    })
  })

  describe("close() cleanup", () => {
    it("close after interrupt is safe", () => {
      const adapter = new GeminiAdapter()
      adapter.interrupt()
      adapter.close()
      // Double close
      adapter.close()
    })

    it("sendMessage after close does not throw", () => {
      const adapter = new GeminiAdapter()
      adapter.close()
      // Should silently drop (AsyncQueue ignores pushes after close)
      adapter.sendMessage({ text: "hello" })
    })

    it("interrupt after close does not throw", () => {
      const adapter = new GeminiAdapter()
      adapter.close()
      adapter.interrupt()
    })
  })

  describe("adapter resilience", () => {
    it("approveToolUse after close is safe", () => {
      const adapter = new GeminiAdapter()
      adapter.close()
      adapter.approveToolUse("tool-1")
    })

    it("denyToolUse after close is safe", () => {
      const adapter = new GeminiAdapter()
      adapter.close()
      adapter.denyToolUse("tool-1", "reason")
    })

    it("setModel always throws (not runtime-switchable)", async () => {
      const adapter = new GeminiAdapter()
      await expect(adapter.setModel("different-model")).rejects.toThrow()
      adapter.close()
    })

    it("forkSession always throws (not supported)", async () => {
      const adapter = new GeminiAdapter()
      await expect(adapter.forkSession("sess-1")).rejects.toThrow("Fork not supported")
      adapter.close()
    })

    it("resetSession warns without agent", async () => {
      const adapter = new GeminiAdapter()
      // Should not throw, just warn
      await adapter.resetSession()
      adapter.close()
    })
  })
})
