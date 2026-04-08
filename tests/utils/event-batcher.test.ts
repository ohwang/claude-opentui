import { describe, expect, it, mock } from "bun:test"
import { EventBatcher } from "../../src/utils/event-batcher"
import type { AgentEvent } from "../../src/protocol/types"

describe("EventBatcher", () => {
  it("flushes immediately on first event (no prior flush)", () => {
    const handler = mock<(events: AgentEvent[]) => void>(() => {})
    const batcher = new EventBatcher(handler)

    batcher.push({ type: "text_delta", text: "hello" })

    // Should flush immediately since lastFlush is 0
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0]![0]).toEqual([
      { type: "text_delta", text: "hello" },
    ])

    batcher.destroy()
  })

  it("batches events within 16ms window", async () => {
    const handler = mock<(events: AgentEvent[]) => void>(() => {})
    const batcher = new EventBatcher(handler)

    // First event flushes immediately
    batcher.push({ type: "text_delta", text: "a" })
    expect(handler).toHaveBeenCalledTimes(1)

    // Rapidly push more events (within 16ms)
    batcher.push({ type: "text_delta", text: "b" })
    batcher.push({ type: "text_delta", text: "c" })

    // Not flushed yet (within 16ms window)
    expect(handler).toHaveBeenCalledTimes(1)

    // Wait for the 16ms timer
    await new Promise((resolve) => setTimeout(resolve, 25))

    // Now should have flushed the batch
    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler.mock.calls[1]![0]).toEqual([
      { type: "text_delta", text: "b" },
      { type: "text_delta", text: "c" },
    ])

    batcher.destroy()
  })

  it("manual flush drains the queue", () => {
    const handler = mock<(events: AgentEvent[]) => void>(() => {})
    const batcher = new EventBatcher(handler)

    // First event auto-flushes
    batcher.push({ type: "text_delta", text: "a" })

    // Queue more
    batcher.push({ type: "text_delta", text: "b" })
    batcher.push({ type: "text_delta", text: "c" })

    // Manual flush
    batcher.flush()

    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler.mock.calls[1]![0]).toHaveLength(2)

    batcher.destroy()
  })

  it("flush with empty queue is a no-op", () => {
    const handler = mock<(events: AgentEvent[]) => void>(() => {})
    const batcher = new EventBatcher(handler)

    batcher.flush()

    expect(handler).not.toHaveBeenCalled()

    batcher.destroy()
  })

  it("destroy flushes queued events before teardown", async () => {
    const handler = mock<(events: AgentEvent[]) => void>(() => {})
    const batcher = new EventBatcher(handler)

    // First event flushes immediately
    batcher.push({ type: "text_delta", text: "a" })

    // Queue event (within 16ms window, so it's pending)
    batcher.push({ type: "text_delta", text: "b" })

    // Destroy flushes remaining events before teardown
    batcher.destroy()

    await new Promise((resolve) => setTimeout(resolve, 25))

    // Handler called twice: once for the immediate flush, once for the destroy flush
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it("push after destroy is silently ignored", () => {
    const handler = mock<(events: AgentEvent[]) => void>(() => {})
    const batcher = new EventBatcher(handler)

    batcher.destroy()

    // Push after destroy should be ignored (no timer leak)
    batcher.push({ type: "text_delta", text: "leaked" })

    expect(handler).toHaveBeenCalledTimes(0)
  })

  it("handles multiple flush cycles", async () => {
    const handler = mock<(events: AgentEvent[]) => void>(() => {})
    const batcher = new EventBatcher(handler)

    // Cycle 1
    batcher.push({ type: "turn_start" })
    expect(handler).toHaveBeenCalledTimes(1)

    // Wait for 16ms window to pass
    await new Promise((resolve) => setTimeout(resolve, 20))

    // Cycle 2
    batcher.push({ type: "text_delta", text: "hello" })
    expect(handler).toHaveBeenCalledTimes(2)

    // Wait again
    await new Promise((resolve) => setTimeout(resolve, 20))

    // Cycle 3
    batcher.push({ type: "turn_complete" })
    expect(handler).toHaveBeenCalledTimes(3)

    batcher.destroy()
  })

  describe("error handling", () => {
    it("calls onError when handler throws", async () => {
      let caughtError: Error | null = null
      const batcher = new EventBatcher(
        () => { throw new Error("handler boom") },
        16,
        (err) => { caughtError = err },
      )
      batcher.push({ type: "text_delta", text: "event" })
      await new Promise((r) => setTimeout(r, 50))
      expect(caughtError).not.toBeNull()
      expect(caughtError!.message).toBe("handler boom")
      batcher.destroy()
    })

    it("continues accepting events after handler error", async () => {
      let callCount = 0
      const batcher = new EventBatcher(
        (_events) => {
          callCount++
          if (callCount === 1) throw new Error("first call fails")
        },
        16,
        () => {}, // swallow error
      )
      batcher.push({ type: "text_delta", text: "event1" })
      await new Promise((r) => setTimeout(r, 50))
      batcher.push({ type: "text_delta", text: "event2" })
      await new Promise((r) => setTimeout(r, 50))
      expect(callCount).toBeGreaterThanOrEqual(2)
      batcher.destroy()
    })

    it("does not crash when handler throws without onError", async () => {
      const batcher = new EventBatcher(
        () => { throw new Error("no callback") },
        16,
        // no onError
      )
      batcher.push({ type: "text_delta", text: "event" })
      await new Promise((r) => setTimeout(r, 50))
      // Should not have crashed
      batcher.destroy()
    })
  })
})
