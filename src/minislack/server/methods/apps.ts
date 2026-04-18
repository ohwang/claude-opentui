/**
 * apps.connections.open — hand out a Socket Mode WebSocket URL.
 *
 * Real Slack returns a short-lived wss:// URL including an opaque token.
 * We return `ws://<host>:<port>/link/<socketId>` where socketId is a
 * deterministic-enough nonce that the WS handler exchanges for app context.
 */

import { randomUUID } from "node:crypto"
import type { AuthContext } from "../auth"
import { MinislackError } from "../../core/channels"

export interface AppsConnectionsOpenResponse {
  ok: true
  url: string
}

export interface SocketRegistry {
  /** Register a pending WS handoff; the socketId is a one-time credential. */
  register(socketId: string, appId: string): void
  /** Exchange a socketId for its appId. Consumes the registration. */
  consume(socketId: string): string | undefined
}

export function createSocketRegistry(): SocketRegistry {
  const pending = new Map<string, string>()
  return {
    register(socketId, appId) {
      pending.set(socketId, appId)
    },
    consume(socketId) {
      const appId = pending.get(socketId)
      if (appId) pending.delete(socketId)
      return appId
    },
  }
}

export function appsConnectionsOpen(
  ctx: AuthContext,
  baseWsUrl: string,
  sockets: SocketRegistry,
): AppsConnectionsOpenResponse {
  if (ctx.kind !== "app" || !ctx.appId) {
    throw new MinislackError("not_authed", "apps.connections.open requires an app-level token")
  }
  const socketId = randomUUID()
  sockets.register(socketId, ctx.appId)
  return { ok: true, url: `${baseWsUrl}/link/${socketId}` }
}
