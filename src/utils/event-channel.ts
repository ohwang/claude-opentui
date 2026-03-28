/**
 * Async Event Channel
 *
 * Multiple producers, single consumer. Breaks the deadlock between
 * SDK iteration (which blocks on `for await`) and canUseTool callbacks
 * (which push permission_request events that must reach the TUI immediately).
 *
 * Without this channel, the adapter deadlocks:
 *   1. SDK calls canUseTool → pushes permission_request to a buffer → blocks
 *   2. iterateQuery is blocked on `for await (const msg of this.activeQuery)`
 *   3. SDK can't yield because canUseTool hasn't resolved
 *   4. Buffer never drains → TUI never sees the permission dialog → deadlock
 *
 * The channel lets both SDK messages and callback events flow through a single
 * async iterable, so iterateQuery yields from the channel instead of from
 * the SDK directly.
 */

export class EventChannel<T> {
  private queue: T[] = []
  private waiters: ((value: IteratorResult<T>) => void)[] = []
  private closed = false

  push(item: T): void {
    if (this.closed) return
    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!
      waiter({ value: item, done: false })
    } else {
      this.queue.push(item)
    }
  }

  close(): void {
    this.closed = true
    for (const w of this.waiters) {
      w({ value: undefined as any, done: true })
    }
    this.waiters = []
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!
      } else if (this.closed) {
        return
      } else {
        const result = await new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push(resolve)
        })
        if (result.done) return
        yield result.value
      }
    }
  }
}
