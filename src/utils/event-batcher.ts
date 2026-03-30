/**
 * Event Batcher
 *
 * Coalesces AgentEvents at 16ms intervals (one 60 FPS frame).
 * First event in a batch flushes immediately for responsiveness.
 * Subsequent events within 16ms are batched and flushed together.
 *
 * Pattern from OpenCode's sdk.tsx: accumulate events in array,
 * setTimeout(flush, 16) if within 16ms of last flush.
 * Wraps all signal updates in Solid's batch().
 */

import type { AgentEvent } from "../protocol/types"

export type EventHandler = (events: AgentEvent[]) => void

export class EventBatcher {
  private queue: AgentEvent[] = []
  private timer: Timer | undefined
  private lastFlush = 0
  private handler: EventHandler
  private destroyed = false

  constructor(handler: EventHandler) {
    this.handler = handler
  }

  push(event: AgentEvent): void {
    if (this.destroyed) return

    this.queue.push(event)

    const now = Date.now()
    const elapsed = now - this.lastFlush

    if (elapsed >= 16) {
      // Been 16ms+ since last flush, flush immediately
      this.flush()
    } else if (!this.timer) {
      // Schedule flush for remaining time in the 16ms window
      this.timer = setTimeout(() => this.flush(), 16 - elapsed)
    }
  }

  flush(): void {
    if (this.queue.length === 0) return

    const events = this.queue
    this.queue = []
    clearTimeout(this.timer)
    this.timer = undefined
    this.lastFlush = Date.now()

    this.handler(events)
  }

  destroy(): void {
    this.flush()
    this.destroyed = true
    clearTimeout(this.timer)
    this.timer = undefined
  }
}
