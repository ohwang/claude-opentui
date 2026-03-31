import { describe, expect, it } from "bun:test"
import { EventChannel } from "../../src/utils/event-channel"

/** Collect all items from an async iterable into an array. */
async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = []
  for await (const item of iter) {
    items.push(item)
  }
  return items
}

/** Yield control to the microtask queue. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

describe("EventChannel", () => {
  // ── 1. Push-then-iterate ─────────────────────────────────────────────
  it("yields buffered items in FIFO order when pushed before consuming", async () => {
    const ch = new EventChannel<number>()

    ch.push(1)
    ch.push(2)
    ch.push(3)
    ch.close()

    const items = await collect(ch)
    expect(items).toEqual([1, 2, 3])
  })

  // ── 2. Iterate-then-push (blocking consumer) ────────────────────────
  it("unblocks a waiting consumer when items are pushed later", async () => {
    const ch = new EventChannel<string>()
    const received: string[] = []

    // Start consuming — will block because queue is empty
    const consumer = (async () => {
      for await (const item of ch) {
        received.push(item)
      }
    })()

    await tick()

    ch.push("a")
    ch.push("b")
    await tick()

    ch.close()
    await consumer

    expect(received).toEqual(["a", "b"])
  })

  // ── 3. Multiple producers ───────────────────────────────────────────
  it("preserves push order across interleaved producers", async () => {
    const ch = new EventChannel<string>()

    // Simulate two concurrent producers pushing alternately
    const producerA = async () => {
      ch.push("a1")
      await tick()
      ch.push("a2")
    }
    const producerB = async () => {
      ch.push("b1")
      await tick()
      ch.push("b2")
    }

    const consumer = collect(ch)

    await Promise.all([producerA(), producerB()])
    ch.close()

    const items = await consumer
    // a1 and b1 are pushed synchronously before the first tick,
    // then a2 and b2 after the tick — order within each tick is deterministic
    expect(items).toEqual(["a1", "b1", "a2", "b2"])
  })

  // ── 4. Close while consumer is waiting ──────────────────────────────
  it("resolves a blocked consumer with done when closed", async () => {
    const ch = new EventChannel<number>()

    const consumer = collect(ch)

    await tick()

    // Consumer is now blocked on next() — close should unblock it
    ch.close()

    const items = await consumer
    expect(items).toEqual([])
  })

  // ── 5. Push after close ─────────────────────────────────────────────
  it("silently drops items pushed after close", async () => {
    const ch = new EventChannel<number>()

    ch.push(1)
    ch.close()
    ch.push(2) // should be silently dropped
    ch.push(3) // should be silently dropped

    const items = await collect(ch)
    expect(items).toEqual([1])
  })

  // ── 6. Close after close ────────────────────────────────────────────
  it("is idempotent — double close does not throw", async () => {
    const ch = new EventChannel<number>()

    ch.push(1)
    ch.close()
    ch.close() // second close must not throw

    const items = await collect(ch)
    expect(items).toEqual([1])
  })

  // ── 7. Drain queue then close ───────────────────────────────────────
  it("terminates cleanly after all queued items are consumed", async () => {
    const ch = new EventChannel<number>()
    const received: number[] = []

    // Push N items
    for (let i = 0; i < 100; i++) ch.push(i)

    // Start consuming
    const consumer = (async () => {
      for await (const item of ch) {
        received.push(item)
      }
    })()

    // Give the consumer time to drain the queue
    await tick()

    // All 100 items consumed, now close
    ch.close()
    await consumer

    expect(received).toEqual(Array.from({ length: 100 }, (_, i) => i))
  })

  // ── 8. Interleaved push/consume ─────────────────────────────────────
  it("handles alternating push and next calls", async () => {
    const ch = new EventChannel<number>()
    const iter = ch[Symbol.asyncIterator]()

    ch.push(1)
    const r1 = await iter.next()
    expect(r1).toEqual({ value: 1, done: false })

    ch.push(2)
    const r2 = await iter.next()
    expect(r2).toEqual({ value: 2, done: false })

    ch.push(3)
    ch.push(4)
    const r3 = await iter.next()
    const r4 = await iter.next()
    expect(r3).toEqual({ value: 3, done: false })
    expect(r4).toEqual({ value: 4, done: false })

    ch.close()
    const r5 = await iter.next()
    expect(r5.done).toBe(true)
  })

  // ── 9. Multiple waiters ─────────────────────────────────────────────
  it("resolves multiple waiting consumers in FIFO waiter order", async () => {
    const ch = new EventChannel<number>()
    const iter = ch[Symbol.asyncIterator]()

    // Start two next() calls — both will block as queue is empty
    const p1 = iter.next()
    const p2 = iter.next()

    await tick()

    // Push two items — each should resolve one waiter in order
    ch.push(10)
    ch.push(20)

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toEqual({ value: 10, done: false })
    expect(r2).toEqual({ value: 20, done: false })

    ch.close()
  })

  // ── 10. Empty close ─────────────────────────────────────────────────
  it("closes cleanly with no pushes and no consumers", () => {
    const ch = new EventChannel<number>()
    // Nothing pushed, no iteration started — close must not throw
    ch.close()
  })

  // ── Additional edge case: close resolves all pending waiters ────────
  it("resolves all pending waiters with done on close", async () => {
    const ch = new EventChannel<number>()
    const iter = ch[Symbol.asyncIterator]()

    // Three pending next() calls
    const p1 = iter.next()
    const p2 = iter.next()
    const p3 = iter.next()

    await tick()

    ch.close()

    const [r1, r2, r3] = await Promise.all([p1, p2, p3])
    expect(r1.done).toBe(true)
    expect(r2.done).toBe(true)
    expect(r3.done).toBe(true)
  })
})
