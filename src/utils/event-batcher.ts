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

import type { ConversationEvent } from "../protocol/types"
import { log } from "./logger"

export type EventHandler = (events: ConversationEvent[]) => void

export class EventBatcher {
  private queue: ConversationEvent[] = []
  private timer: Timer | undefined
  private lastFlush = 0
  private handler: EventHandler
  private destroyed = false
  private onError?: (error: Error) => void

  constructor(
    handler: EventHandler,
    private interval: number = 16,
    onError?: (error: Error) => void,
  ) {
    this.handler = handler
    this.onError = onError
  }

  push(event: ConversationEvent): void {
    if (this.destroyed) return

    this.queue.push(event)

    const now = Date.now()
    const elapsed = now - this.lastFlush

    if (elapsed >= this.interval) {
      // Been 16ms+ since last flush, flush immediately
      this.flush()
    } else if (!this.timer) {
      // Schedule flush for remaining time in the 16ms window
      this.timer = setTimeout(() => this.flush(), this.interval - elapsed)
    }
  }

  flush(): void {
    if (this.queue.length === 0) return

    const events = this.queue
    this.queue = []
    clearTimeout(this.timer)
    this.timer = undefined
    this.lastFlush = Date.now()

    try {
      this.handler(events)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      // Log to session file (visible in debug logs) instead of console.error
      // which is invisible in a full-screen TUI
      log.error("EventBatcher handler error", { error: error.message })
      this.onError?.(error)
    }
  }

  destroy(): void {
    this.flush()
    this.destroyed = true
    clearTimeout(this.timer)
    this.timer = undefined
  }
}
