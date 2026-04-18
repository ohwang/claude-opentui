/**
 * startMinislack — the library + test API.
 *
 * Boots an in-memory workspace, HTTP server, and WS server on either a
 * specified port or an ephemeral one. Returns a MinislackHandle that
 * exposes a live read-only workspace, scoped UserClients, app registration,
 * an EventBus subscription, a snapshot() helper, and a clean stop().
 */

import type { Server } from "bun"
import { createWorkspace, registerApp, createUser, tokenForUser } from "../core/workspace"
import type { RegisteredApp } from "../core/workspace"
import { createEventBus, type EventBus, type EventFilter, type Unsubscribe } from "../core/events"
import { handleHttp, createSocketsRegistry } from "../server/http"
import { buildWebSocketHandler, type WsData } from "../server/websocket"
import { buildWebBundle, type WebBundle } from "../server/web-bundle"
import type { Workspace, User, Channel, Message } from "../types/slack"
import type { SlackEvent } from "../types/events"
import { applyFixture, type FixtureName } from "./fixtures"

export interface UserClient {
  user: User
  token: string
  sendMessage(channel: string, text: string, opts?: { thread_ts?: string }): Promise<Message>
  history(channel: string, opts?: { latest?: string; oldest?: string; limit?: number; inclusive?: boolean }): Promise<Message[]>
}

export interface RegisterAppOpts {
  name: string
  scopes?: string[]
  subscribed_events?: string[]
}

export interface MinislackHandle {
  port: number
  url: string
  wsUrl(socketId: string): string
  workspace: Workspace
  bus: EventBus
  asUser(nameOrId: string): UserClient
  registerApp(opts: RegisterAppOpts): RegisteredApp
  events: {
    subscribe(filter: EventFilter, handler: (evt: SlackEvent) => void): Unsubscribe
  }
  snapshot(): WorkspaceSnapshot
  stop(): Promise<void>
}

export interface WorkspaceSnapshot {
  team: Workspace["team"]
  users: User[]
  channels: Array<Omit<Channel, "messages"> & { messages: Message[] }>
  apps: Array<ReturnType<typeof appSummary>>
}

export interface StartMinislackOpts {
  /** 0 = ephemeral port (default for tests). */
  port?: number
  /** Preset or a snapshot to rehydrate. Phase 1 supports only named presets. */
  fixture?: FixtureName
  /** Reserved for Phase 8. */
  persist?: string
  /** Reserved for Phase 2. */
  serveWeb?: boolean
}

export async function startMinislack(opts: StartMinislackOpts = {}): Promise<MinislackHandle> {
  const ws = createWorkspace({ teamName: "Minislack", teamDomain: "minislack" })
  const bus = createEventBus()

  if (opts.fixture) applyFixture(ws, opts.fixture)

  const sockets = createSocketsRegistry()

  let web: WebBundle | undefined
  if (opts.serveWeb !== false) {
    try {
      web = await buildWebBundle()
    } catch (err) {
      // Surface the bundler error up front so it's never mysterious.
      console.error("[minislack] web bundle failed:", err)
      throw err
    }
  }

  let resolvedPort = 0
  let wsBase = ""
  let baseHttp = ""
  const server: Server<WsData> = Bun.serve<WsData>({
    port: opts.port ?? 0,
    // SSE streams must outlive Bun's default 10s idle timeout.
    idleTimeout: 0,
    async fetch(req, srv) {
      const url = new URL(req.url)
      if (url.pathname.startsWith("/link/")) {
        const socketId = url.pathname.slice("/link/".length)
        const ok = srv.upgrade(req, { data: { socketId, ackedEnvelopes: [] } as WsData })
        if (ok) return undefined as unknown as Response
        return new Response("expected websocket", { status: 426 })
      }
      return handleHttp(req, {
        ws,
        bus,
        sockets,
        wsBase: () => wsBase,
        baseHttp: () => baseHttp,
        web,
      })
    },
    websocket: buildWebSocketHandler({ ws, bus, sockets }),
  })
  resolvedPort = server.port ?? 0
  const host = server.hostname === "0.0.0.0" || server.hostname === "::" ? "localhost" : server.hostname
  baseHttp = `http://${host}:${resolvedPort}`
  wsBase = `ws://${host}:${resolvedPort}`

  const handle: MinislackHandle = {
    port: resolvedPort,
    url: baseHttp,
    wsUrl(socketId: string) { return `${wsBase}/link/${socketId}` },
    workspace: ws,
    bus,
    asUser(nameOrId: string): UserClient {
      const user = resolveOrCreateUser(ws, nameOrId)
      const token = tokenForUser(user)
      return buildUserClient(baseHttp, user, token)
    },
    registerApp(opts) {
      return registerApp(ws, opts)
    },
    events: {
      subscribe(filter, handler) {
        return bus.subscribe(filter, handler)
      },
    },
    snapshot() {
      return snapshotWorkspace(ws)
    },
    async stop() {
      server.stop(true)
    },
  }
  return handle
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveOrCreateUser(ws: Workspace, nameOrId: string): User {
  if (ws.users.has(nameOrId)) return ws.users.get(nameOrId)!
  const handle = nameOrId.startsWith("@") ? nameOrId.slice(1) : nameOrId
  for (const u of ws.users.values()) if (u.name === handle) return u
  return createUser(ws, { name: handle })
}

function buildUserClient(base: string, user: User, token: string): UserClient {
  async function call(method: string, args: unknown): Promise<any> {
    const res = await fetch(`${base}/api/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(args ?? {}),
    })
    const body = (await res.json()) as { ok: boolean; error?: string; [k: string]: unknown }
    if (!body.ok) throw new Error(`slack api error: ${body.error}`)
    return body
  }
  return {
    user,
    token,
    async sendMessage(channel, text, opts = {}) {
      const out = await call("chat.postMessage", {
        channel,
        text,
        ...(opts.thread_ts ? { thread_ts: opts.thread_ts } : {}),
      })
      return out.message as Message
    },
    async history(channel, opts = {}) {
      const out = await call("conversations.history", {
        channel,
        ...(opts.latest ? { latest: opts.latest } : {}),
        ...(opts.oldest ? { oldest: opts.oldest } : {}),
        ...(opts.limit ? { limit: opts.limit } : {}),
        ...(opts.inclusive ? { inclusive: opts.inclusive } : {}),
      })
      return out.messages as Message[]
    },
  }
}

function appSummary(app: ReturnType<Workspace["apps"]["get"]> & {}) {
  return {
    id: app.id,
    name: app.name,
    bot_id: app.bot_id,
    bot_user_id: app.bot_user_id,
    scopes: app.scopes,
    subscribed_events: app.subscribed_events,
  }
}

function snapshotWorkspace(ws: Workspace): WorkspaceSnapshot {
  const channels: WorkspaceSnapshot["channels"] = []
  for (const ch of ws.channels.values()) {
    const messages = Array.from(ch.messages.values())
    channels.push({ ...(ch as Channel & { messages: Map<string, Message> }), messages })
  }
  return {
    team: ws.team,
    users: Array.from(ws.users.values()),
    channels,
    apps: Array.from(ws.apps.values()).map((a) => appSummary(a)),
  }
}
