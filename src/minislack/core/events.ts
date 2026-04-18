/**
 * Tiny typed event bus. Every mutating core/ function publishes; server/
 * websocket.ts fans events out to connected apps; server/internal-events.ts
 * fans events to the web SPA via SSE.
 *
 * Kept intentionally small: synchronous publish, Set of subscribers, no
 * buffering. Phase 8 (persistence) may layer a write-behind queue here
 * but the public shape doesn't change.
 */

import type { SlackEvent, SlackEventType } from "../types/events"

export type Unsubscribe = () => void

export interface EventFilter {
  /** Event type whitelist. Missing/empty = all. */
  types?: SlackEventType[]
  /** Channel id whitelist. Missing/empty = all channels. */
  channels?: string[]
}

export type EventHandler = (evt: SlackEvent) => void

export interface EventBus {
  subscribe(filter: EventFilter, handler: EventHandler): Unsubscribe
  publish(evt: SlackEvent): void
  /** Subscriber count — useful for tests. */
  readonly subscriberCount: number
}

interface Subscription {
  filter: EventFilter
  handler: EventHandler
}

export function createEventBus(): EventBus {
  const subs = new Set<Subscription>()

  function matches(sub: Subscription, evt: SlackEvent): boolean {
    if (sub.filter.types && sub.filter.types.length > 0) {
      if (!sub.filter.types.includes(evt.type)) return false
    }
    if (sub.filter.channels && sub.filter.channels.length > 0) {
      const ch = extractChannel(evt)
      if (!ch || !sub.filter.channels.includes(ch)) return false
    }
    return true
  }

  return {
    subscribe(filter, handler) {
      const sub: Subscription = { filter, handler }
      subs.add(sub)
      return () => {
        subs.delete(sub)
      }
    },
    publish(evt) {
      // Copy first so a handler that unsubscribes during iteration doesn't
      // break the loop.
      for (const sub of [...subs]) {
        if (matches(sub, evt)) {
          try {
            sub.handler(evt)
          } catch (err) {
            // A faulty handler must not break the bus.
            console.error("[minislack] event handler threw:", err)
          }
        }
      }
    },
    get subscriberCount() {
      return subs.size
    },
  }
}

/** Pull a channel id out of any variant that carries one. */
function extractChannel(evt: SlackEvent): string | undefined {
  if ("channel" in evt && typeof evt.channel === "string") return evt.channel
  if ("channel_id" in evt && typeof evt.channel_id === "string") return evt.channel_id
  if ("item" in evt && evt.item.channel) return evt.item.channel
  if (evt.type === "channel_created" || evt.type === "channel_rename") {
    return evt.channel.id
  }
  return undefined
}
