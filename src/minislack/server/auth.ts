/**
 * Bearer token parsing and minting.
 *
 * minislack skips signature verification (plan locked decision) — the
 * Authorization header is the only credential. Tokens are opaque to
 * clients but have a deterministic internal shape so we can read them
 * back without storing a token table.
 *
 *   xoxp-<userId>       — user token (acts as that user)
 *   xoxb-<appId>        — bot token (acts as the app's bot user)
 *   xapp-<appId>        — app-level token (apps.connections.open only)
 *
 * Real Slack mixes a random segment into each token. We omit that because
 * there's no secret to leak in a local fake, and deterministic tokens make
 * snapshots/fixtures round-trip cleanly in tests.
 */

import type { Workspace } from "../types/slack"

export interface AuthContext {
  /** Token kind. */
  kind: "user" | "bot" | "app"
  /** The acting user id — for bot tokens, the app's bot user. */
  userId?: string
  /** For bot or app tokens. */
  appId?: string
  /** For bot tokens: the Bot record id. */
  botId?: string
  /** The raw token string. */
  raw: string
}

// ---------------------------------------------------------------------------
// Token minting
// ---------------------------------------------------------------------------

export function userTokenForUser(userId: string): string {
  return `xoxp-${userId}`
}
export function botTokenForApp(appId: string): string {
  return `xoxb-${appId}`
}
export function appTokenForApp(appId: string): string {
  return `xapp-${appId}`
}

// ---------------------------------------------------------------------------
// Header parsing
// ---------------------------------------------------------------------------

/**
 * Extract the raw token from an Authorization header, or undefined if absent.
 * Accepts "Bearer <token>" (standard) and bare "<token>" (some Slack SDKs).
 */
export function extractBearer(headerValue: string | null | undefined): string | undefined {
  if (!headerValue) return undefined
  const m = /^Bearer\s+(.+)$/i.exec(headerValue.trim())
  if (m && m[1]) return m[1].trim()
  return headerValue.trim() || undefined
}

/**
 * Resolve a token against the workspace. Returns AuthContext or `null` if the
 * token is well-formed but references a missing principal, and `undefined`
 * if the token has the wrong shape entirely.
 */
export function resolveToken(
  ws: Workspace,
  token: string | undefined,
): AuthContext | null | undefined {
  if (!token) return undefined
  if (token.startsWith("xoxp-")) {
    const userId = token.slice("xoxp-".length)
    const user = ws.users.get(userId)
    if (!user) return null
    return { kind: "user", userId: user.id, raw: token }
  }
  if (token.startsWith("xoxb-")) {
    const appId = token.slice("xoxb-".length)
    const app = ws.apps.get(appId)
    if (!app) return null
    return {
      kind: "bot",
      userId: app.bot_user_id,
      appId: app.id,
      botId: app.bot_id,
      raw: token,
    }
  }
  if (token.startsWith("xapp-")) {
    const appId = token.slice("xapp-".length)
    const app = ws.apps.get(appId)
    if (!app) return null
    return { kind: "app", appId: app.id, raw: token }
  }
  return undefined
}
