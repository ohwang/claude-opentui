/**
 * SSE at /_minislack/events — live event stream for the web SPA.
 *
 * The SPA opens `new EventSource("/_minislack/events")` and receives one
 * Slack event per SSE "message" event as a JSON-encoded line. This is a
 * browser-internal channel — the Slack frontend never uses it.
 *
 * Keepalive: a `:ping` comment line fires every 15s to keep proxies and
 * the browser from closing the connection when idle.
 */

import type { EventBus } from "../core/events"
import type { SlackEvent } from "../types/events"

const KEEPALIVE_MS = 15_000

export function sseEventsResponse(bus: EventBus): Response {
  let unsubscribe: (() => void) | undefined
  let keepalive: ReturnType<typeof setInterval> | undefined
  let closed = false
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      function safeEnqueue(chunk: Uint8Array): void {
        if (closed) return
        try {
          controller.enqueue(chunk)
        } catch {
          teardown()
        }
      }

      function teardown(): void {
        if (closed) return
        closed = true
        unsubscribe?.()
        unsubscribe = undefined
        if (keepalive) {
          clearInterval(keepalive)
          keepalive = undefined
        }
      }

      // Initial priming comment to open the stream immediately
      safeEnqueue(encoder.encode(": minislack-sse\n\n"))

      unsubscribe = bus.subscribe({}, (evt: SlackEvent) => {
        safeEnqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`))
      })

      keepalive = setInterval(() => {
        safeEnqueue(encoder.encode(`: ping ${Date.now()}\n\n`))
      }, KEEPALIVE_MS)
    },
    cancel() {
      closed = true
      unsubscribe?.()
      unsubscribe = undefined
      if (keepalive) {
        clearInterval(keepalive)
        keepalive = undefined
      }
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
