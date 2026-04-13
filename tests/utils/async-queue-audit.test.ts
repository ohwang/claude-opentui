/**
 * AsyncQueue audit tests — message queuing bugbash (2026-04-13).
 *
 * Complements the existing async-queue.test.ts by locking in behaviors the
 * message-queuing audit explicitly called out:
 *   - push/pull ordering across interleavings
 *   - close() rejects pending pulls
 *   - close() buffered-item behavior (documents ACTUAL semantics: buffered
 *     items are NOT discarded on close, they remain pullable until drained)
 *   - push-after-close is a silent no-op
 *   - waiting pullers get rejected; a subsequent drain does not resurrect
 *     discarded items.
 *
 * AUDIT FINDING: The audit brief asked for "close() discards buffered items".
 * The implementation instead preserves buffered items across close() — the
 * closed flag is only checked when shift() returns undefined. That behavior
 * is intentional per the existing test at tests/utils/async-queue.test.ts:183
 * and is the less-surprising option for our callers (Claude adapter, Codex
 * adapter, subagent backends) because the message loop always pulls until the
 * queue throws, and the loop checks `this.closed` between pulls anyway.
 * Tests below therefore assert the current behavior.
 */

import { describe, expect, it } from "bun:test"
import { AsyncQueue } from "../../src/utils/async-queue"

describe("AsyncQueue — message-queuing audit", () => {
  describe("push/pull ordering", () => {
    it("strict FIFO across a large fanout", async () => {
      const q = new AsyncQueue<number>()
      for (let i = 0; i < 1000; i++) q.push(i)

      const out: number[] = []
      for (let i = 0; i < 1000; i++) out.push(await q.pull())

      for (let i = 0; i < 1000; i++) expect(out[i]).toBe(i)
    })

    it("waiting pullers are served in order even when pushes come in bursts", async () => {
      const q = new AsyncQueue<string>()

      const pulls = Array.from({ length: 5 }, () => q.pull())

      // One big burst
      q.push("a"); q.push("b"); q.push("c"); q.push("d"); q.push("e")

      const results = await Promise.all(pulls)
      expect(results).toEqual(["a", "b", "c", "d", "e"])
    })

    it("mixing buffered + waiting pullers keeps FIFO", async () => {
      const q = new AsyncQueue<number>()
      q.push(1)
      q.push(2)

      // First two pulls synchronous from buffer
      expect(await q.pull()).toBe(1)
      expect(await q.pull()).toBe(2)

      // Next puller must wait
      const pending = q.pull()
      q.push(3)
      expect(await pending).toBe(3)
    })
  })

  describe("close() rejects pending pulls", () => {
    it("a single waiting puller rejects with 'Queue closed'", async () => {
      const q = new AsyncQueue<number>()
      const p = q.pull()
      q.close()
      await expect(p).rejects.toThrow("Queue closed")
    })

    it("all N waiting pullers reject when close() is called once", async () => {
      const q = new AsyncQueue<number>()
      const handlers = Array.from({ length: 10 }, () =>
        q.pull().catch((e: Error) => e.message),
      )

      q.close()

      const results = await Promise.all(handlers)
      for (const r of results) expect(r).toBe("Queue closed")
    })

    it("pull()s issued AFTER close() reject synchronously", async () => {
      const q = new AsyncQueue<number>()
      q.close()

      // These must reject; they should never hang.
      await expect(q.pull()).rejects.toThrow("Queue closed")
      await expect(q.pull()).rejects.toThrow("Queue closed")
    })
  })

  describe("buffered-item behavior on close()", () => {
    it("items buffered BEFORE close remain pullable until drained", async () => {
      // AUDIT NOTE: This documents the ACTUAL behavior, which differs from
      // the audit brief's "close() discards buffered items" expectation.
      // See file header for reasoning.
      const q = new AsyncQueue<string>()
      q.push("a")
      q.push("b")
      q.push("c")

      q.close()

      expect(await q.pull()).toBe("a")
      expect(await q.pull()).toBe("b")
      expect(await q.pull()).toBe("c")

      // Once drained, the next pull rejects.
      await expect(q.pull()).rejects.toThrow("Queue closed")
    })

    it("size still reflects buffered items after close()", () => {
      const q = new AsyncQueue<number>()
      q.push(1)
      q.push(2)
      q.close()
      expect(q.size).toBe(2)
    })
  })

  describe("push-after-close is a no-op", () => {
    it("push() after close() does not throw and does not grow the queue", () => {
      const q = new AsyncQueue<number>()
      q.close()
      q.push(1)
      q.push(2)
      q.push(3)
      expect(q.size).toBe(0)
    })

    it("push() after close() does not resurrect rejected waiters", async () => {
      const q = new AsyncQueue<number>()
      const p = q.pull().catch((e: Error) => e.message)
      q.close()
      // Rejection has already been scheduled; pushing after should do nothing.
      q.push(42)
      expect(await p).toBe("Queue closed")
    })
  })

  describe("regression: adapter close-then-push race", () => {
    it("sendMessage() racing with close() never throws in the caller", () => {
      // The pattern: caller does q.push(msg) then q.close() (or vice versa)
      // under concurrent pressure. Neither call must throw.
      const q = new AsyncQueue<string>()

      // order 1: push first
      q.push("a")
      expect(() => q.close()).not.toThrow()

      const q2 = new AsyncQueue<string>()
      // order 2: close first (push becomes a no-op)
      q2.close()
      expect(() => q2.push("a")).not.toThrow()
    })
  })
})
