/**
 * SSE client. Subscribes to /_minislack/events and dispatches each parsed
 * SlackEvent to a handler.
 *
 * EventSource auto-reconnects; we do nothing special on disconnect beyond
 * letting the browser retry.
 */

import type { SlackEvent } from "../types/events"

export function subscribeEvents(onEvent: (evt: SlackEvent) => void): () => void {
  const src = new EventSource("/_minislack/events")
  src.onmessage = (raw) => {
    try {
      const parsed = JSON.parse(raw.data) as SlackEvent
      onEvent(parsed)
    } catch {
      // Ignore malformed frames — not our problem to repair.
    }
  }
  src.onerror = () => {
    // EventSource retries automatically. Silent here — UI shows a dim
    // status indicator driven elsewhere if needed.
  }
  return () => src.close()
}
