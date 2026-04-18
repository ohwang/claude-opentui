/**
 * Messages — post, list, (edit/delete/threads land in later phases).
 *
 * v0 scope: plaintext post + history listing. Everything richer (threads,
 * edit/delete, reactions) is additive and will extend this module in
 * Phases 4–5 without breaking v0 shapes.
 */

import { assertMember, MinislackError } from "./channels"
import { nextTs, compareTs } from "./ts"
import type {
  Channel,
  Message,
  Workspace,
} from "../types/slack"
import type { Block, KnownBlock } from "@slack/types"
import type { MessageAttachment } from "@slack/types"

export interface PostMessageOpts {
  channelId: string
  userId: string
  text: string
  /** Bot context — set when posting via an app's bot token. */
  bot_id?: string
  app_id?: string
  blocks?: (KnownBlock | Block)[]
  attachments?: MessageAttachment[]
  thread_ts?: string
  client_msg_id?: string
  /** Injectable clock for deterministic tests. */
  now?: () => number
}

export function postMessage(ws: Workspace, opts: PostMessageOpts): Message {
  const ch = ws.channels.get(opts.channelId)
  if (!ch) throw new MinislackError("channel_not_found", opts.channelId)
  assertMember(ch, opts.userId)

  if (opts.text.trim().length === 0 && !opts.blocks && !opts.attachments) {
    throw new MinislackError("no_text", "message must have text, blocks, or attachments")
  }

  const ts = nextTs(ws, ch.id, opts.now)
  const msg: Message = {
    type: "message",
    ts,
    channel: ch.id,
    user: opts.userId,
    text: opts.text,
    ...(opts.bot_id ? { bot_id: opts.bot_id, subtype: "bot_message" } : {}),
    ...(opts.app_id ? { app_id: opts.app_id } : {}),
    ...(opts.blocks ? { blocks: opts.blocks } : {}),
    ...(opts.attachments ? { attachments: opts.attachments } : {}),
    ...(opts.thread_ts ? { thread_ts: opts.thread_ts } : {}),
    ...(opts.client_msg_id ? { client_msg_id: opts.client_msg_id } : {}),
  }
  ch.messages.set(ts, msg)
  return msg
}

export interface HistoryOpts {
  /** Return messages strictly older than this ts. */
  latest?: string
  /** Return messages strictly newer than this ts. */
  oldest?: string
  /** Inclusive on the bounds. Default false (Slack default). */
  inclusive?: boolean
  /** Max messages to return. Default 100. */
  limit?: number
}

/**
 * Return channel history in Slack's default order: newest-first, capped.
 * Hides tombstoned messages but keeps their slots reserved.
 */
export function listHistory(
  ch: Channel,
  opts: HistoryOpts = {},
): { messages: Message[]; has_more: boolean } {
  const limit = opts.limit ?? 100
  const inclusive = !!opts.inclusive
  const all: Message[] = []
  for (const m of ch.messages.values()) {
    if (m.tombstone) continue
    if (m.thread_ts && m.thread_ts !== m.ts) {
      // Thread replies are only returned in conversations.replies.
      continue
    }
    if (opts.latest !== undefined) {
      const cmp = compareTs(m.ts, opts.latest)
      if (inclusive ? cmp > 0 : cmp >= 0) continue
    }
    if (opts.oldest !== undefined) {
      const cmp = compareTs(m.ts, opts.oldest)
      if (inclusive ? cmp < 0 : cmp <= 0) continue
    }
    all.push(m)
  }
  all.sort((a, b) => compareTs(b.ts, a.ts)) // newest first
  const sliced = all.slice(0, limit)
  return { messages: sliced, has_more: all.length > sliced.length }
}

/** Fetch a message by ts within a channel, or undefined if missing/tombstoned. */
export function getMessage(ch: Channel, ts: string): Message | undefined {
  const m = ch.messages.get(ts)
  if (!m || m.tombstone) return undefined
  return m
}
