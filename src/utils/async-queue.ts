/**
 * Generic async producer/consumer queue.
 *
 * push() enqueues items; pull() returns a promise that resolves when
 * an item is available. close() rejects any outstanding pull() waiters.
 */

export class AsyncQueue<T> {
  private queue: T[] = []
  private waiting: { resolve: (value: T) => void; reject: (error: Error) => void }[] = []
  private closed = false

  push(item: T): void {
    if (this.closed) return
    const waiter = this.waiting.shift()
    if (waiter) {
      waiter.resolve(item)
    } else {
      this.queue.push(item)
    }
  }

  async pull(): Promise<T> {
    const item = this.queue.shift()
    if (item !== undefined) return item
    if (this.closed) throw new Error("Queue closed")
    return new Promise<T>((resolve, reject) => {
      this.waiting.push({ resolve, reject })
    })
  }

  close(): void {
    this.closed = true
    const err = new Error("Queue closed")
    for (const waiter of this.waiting) {
      waiter.reject(err)
    }
    this.waiting = []
  }

  get size(): number {
    return this.queue.length
  }
}
