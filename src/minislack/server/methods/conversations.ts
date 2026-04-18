/**
 * conversations.* — list / info / history (phase 1).
 *
 * Phase 4 adds `replies`. Phase 3 adds `create`, `join`, `members`, `open`.
 */

import { listHistory } from "../../core/messages"
import { MinislackError } from "../../core/channels"
import type { Channel, Message, Workspace } from "../../types/slack"

export interface ListArgs {
  types?: string       // "public_channel,private_channel,mpim,im" — comma separated
  exclude_archived?: boolean
  limit?: number
  cursor?: string      // unused — Phase 9 if we need pagination
}

export interface ListResponse {
  ok: true
  channels: Channel[]
  response_metadata: { next_cursor: string }
}

export function conversationsList(ws: Workspace, args: ListArgs = {}): ListResponse {
  const requested = parseTypeFilter(args.types ?? "public_channel")
  const out: Channel[] = []
  for (const ch of ws.channels.values()) {
    if (args.exclude_archived) {
      if ("is_archived" in ch && ch.is_archived) continue
    }
    if (!matchesTypeFilter(ch, requested)) continue
    out.push(ch)
  }
  const limit = args.limit ?? 1000
  return {
    ok: true,
    channels: out.slice(0, limit),
    response_metadata: { next_cursor: "" },
  }
}

export interface HistoryArgs {
  channel: string
  latest?: string
  oldest?: string
  inclusive?: boolean
  limit?: number
}

export interface HistoryResponse {
  ok: true
  channel: string
  messages: Message[]
  has_more: boolean
  pin_count: number
}

export function conversationsHistory(ws: Workspace, args: HistoryArgs): HistoryResponse {
  const ch = resolveChannel(ws, args.channel)
  const { messages, has_more } = listHistory(ch, args)
  return {
    ok: true,
    channel: ch.id,
    messages,
    has_more,
    pin_count: 0,
  }
}

export interface InfoArgs {
  channel: string
}

export interface InfoResponse {
  ok: true
  channel: Channel
}

export function conversationsInfo(ws: Workspace, args: InfoArgs): InfoResponse {
  const ch = resolveChannel(ws, args.channel)
  return { ok: true, channel: ch }
}

// ---------------------------------------------------------------------------

function parseTypeFilter(types: string): Set<string> {
  return new Set(types.split(",").map((t) => t.trim()).filter(Boolean))
}

function matchesTypeFilter(ch: Channel, types: Set<string>): boolean {
  if (types.has("public_channel") && ch.is_channel && !ch.is_private) return true
  if (types.has("private_channel") && "is_private" in ch && ch.is_private && !ch.is_im && !ch.is_mpim) return true
  if (types.has("mpim") && ch.is_mpim) return true
  if (types.has("im") && ch.is_im) return true
  return false
}

function resolveChannel(ws: Workspace, idOrName: string): Channel {
  const direct = ws.channels.get(idOrName)
  if (direct) return direct
  const handle = idOrName.startsWith("#") ? idOrName.slice(1) : idOrName
  for (const ch of ws.channels.values()) {
    if ("name" in ch && ch.name === handle) return ch
  }
  throw new MinislackError("channel_not_found", idOrName)
}
