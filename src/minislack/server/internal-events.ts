/**
 * SSE at /_minislack/events — live event stream for the web SPA.
 *
 * The SPA opens `new EventSource("/_minislack/events")` and receives one
 * Slack event per SSE "message" event as a JSON-encoded line. This is a
 * browser-internal channel — the Slack frontend never uses it.
 */

import type { EventBus } from "../core/events"
import type { SlackEvent } from "../types/events"

export function sseEventsResponse(bus: EventBus): Response {
  let unsubscribe: (() => void) | undefined
  let closed = false
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      function send(evt: SlackEvent): void {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`))
        } catch {
          // Stream already closed; drop.
        }
      }

      // Initial comment keeps some proxies from buffering
      controller.enqueue(encoder.encode(": minislack-sse\n\n"))

      unsubscribe = bus.subscribe({}, send)
    },
    cancel() {
      closed = true
      unsubscribe?.()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  })
}
