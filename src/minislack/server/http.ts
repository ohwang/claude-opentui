/**
 * HTTP dispatch — Web API + (future) web SPA + file serving.
 *
 * Phase 1 coverage: auth.test, apps.connections.open, chat.postMessage,
 * conversations.list, conversations.history, conversations.info.
 *
 * Later phases add more /api/<method> entries in `dispatchMethod`, and
 * mount /files/:id (Phase 7), / + /main.js for the SPA (Phase 2), and
 * /_minislack/events SSE (Phase 2).
 */

import { MinislackError } from "../core/channels"
import { extractBearer, resolveToken, type AuthContext } from "./auth"
import { authTest } from "./methods/auth"
import {
  appsConnectionsOpen,
  createSocketRegistry,
  type SocketRegistry,
} from "./methods/apps"
import { chatPostMessage } from "./methods/chat"
import {
  conversationsHistory,
  conversationsInfo,
  conversationsList,
} from "./methods/conversations"
import type { Workspace } from "../types/slack"
import type { EventBus } from "../core/events"

export interface HttpContext {
  ws: Workspace
  bus: EventBus
  sockets: SocketRegistry
  /** The base ws:// URL for apps.connections.open. */
  wsBase: () => string
}

export function createSocketsRegistry(): SocketRegistry {
  return createSocketRegistry()
}

/**
 * Top-level request router. Returns a Response for Bun.serve. The caller is
 * responsible for WS upgrades (server.upgrade()) — that's handled in the
 * launcher because only Bun.serve can perform the upgrade.
 */
export async function handleHttp(req: Request, ctx: HttpContext): Promise<Response> {
  const url = new URL(req.url)
  const { pathname } = url

  // Method routing
  if (pathname.startsWith("/api/")) {
    return dispatchApi(req, pathname.slice("/api/".length), ctx)
  }

  // Phase 2 hooks — not yet implemented but reserve the paths
  if (pathname === "/_minislack/events") {
    return new Response("SSE not yet implemented", { status: 501 })
  }
  if (pathname.startsWith("/_minislack/")) {
    return new Response("not implemented", { status: 501 })
  }
  if (pathname === "/") {
    return new Response("minislack — web UI pending (Phase 2)", { status: 200, headers: { "Content-Type": "text/plain" } })
  }
  if (pathname === "/healthz") {
    return new Response("ok", { status: 200 })
  }
  return new Response("Not Found", { status: 404 })
}

async function dispatchApi(req: Request, method: string, ctx: HttpContext): Promise<Response> {
  try {
    const args = await readArgs(req)
    const authHeader = req.headers.get("authorization")
    const token = extractBearer(authHeader) ?? (typeof args.token === "string" ? args.token : undefined)
    const authResult = resolveToken(ctx.ws, token)

    // auth.test and apps.connections.open both require a token
    if (authResult === undefined) {
      return slackError("not_authed")
    }
    if (authResult === null) {
      return slackError("invalid_auth")
    }

    const auth: AuthContext = authResult

    switch (method) {
      case "auth.test":
        return slackOk(authTest(ctx.ws, auth))
      case "apps.connections.open":
        return slackOk(
          appsConnectionsOpen(auth, ctx.wsBase(), ctx.sockets),
        )
      case "chat.postMessage":
        return slackOk(
          chatPostMessage(ctx.ws, ctx.bus, auth, {
            channel: str(args.channel),
            text: args.text as string | undefined,
            thread_ts: args.thread_ts as string | undefined,
            blocks: args.blocks as chatBlocks,
            attachments: args.attachments as chatAttachments,
            client_msg_id: args.client_msg_id as string | undefined,
          }),
        )
      case "conversations.list":
        return slackOk(
          conversationsList(ctx.ws, {
            types: args.types as string | undefined,
            exclude_archived: toBool(args.exclude_archived),
            limit: toNum(args.limit),
          }),
        )
      case "conversations.history":
        return slackOk(
          conversationsHistory(ctx.ws, {
            channel: str(args.channel),
            latest: args.latest as string | undefined,
            oldest: args.oldest as string | undefined,
            inclusive: toBool(args.inclusive),
            limit: toNum(args.limit),
          }),
        )
      case "conversations.info":
        return slackOk(conversationsInfo(ctx.ws, { channel: str(args.channel) }))
      default:
        return slackError("unknown_method")
    }
  } catch (err) {
    if (err instanceof MinislackError) {
      return slackError(err.code)
    }
    console.error("[minislack] unhandled error:", err)
    return slackError("internal_error")
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type chatBlocks = Parameters<typeof chatPostMessage>[3]["blocks"]
type chatAttachments = Parameters<typeof chatPostMessage>[3]["attachments"]

function slackOk(payload: unknown): Response {
  // Slack always returns { ok: true, ...payload } at the top level — mix them.
  const body = payload && typeof payload === "object" ? { ...(payload as object) } : { ok: true }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  })
}

function slackError(code: string): Response {
  return new Response(JSON.stringify({ ok: false, error: code }), {
    status: 200, // Slack replies 200 with ok:false
    headers: { "Content-Type": "application/json; charset=utf-8" },
  })
}

async function readArgs(req: Request): Promise<Record<string, unknown>> {
  if (req.method === "GET") {
    const url = new URL(req.url)
    const out: Record<string, unknown> = {}
    for (const [k, v] of url.searchParams.entries()) out[k] = v
    return out
  }
  const ct = req.headers.get("content-type") ?? ""
  if (ct.includes("application/json")) {
    try {
      const body = (await req.json()) as unknown
      return body && typeof body === "object" ? (body as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    const form = await req.formData()
    const out: Record<string, unknown> = {}
    for (const [k, v] of form.entries()) out[k] = typeof v === "string" ? v : v
    return out
  }
  // Unknown content-type — try JSON, then fall back to querystring
  try {
    const body = (await req.json()) as unknown
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  } catch {
    const url = new URL(req.url)
    const out: Record<string, unknown> = {}
    for (const [k, v] of url.searchParams.entries()) out[k] = v
    return out
  }
}

function str(v: unknown): string {
  if (typeof v !== "string" || v.length === 0) {
    throw new MinislackError("invalid_arguments", "expected string")
  }
  return v
}

function toBool(v: unknown): boolean | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v === "boolean") return v
  if (typeof v === "string") return v === "true" || v === "1"
  return undefined
}

function toNum(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v === "number") return v
  if (typeof v === "string") {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}
