/**
 * chat.postMessage — post a message as the authed principal.
 *
 * Phase 1: plaintext + thread_ts + blocks/attachments passthrough. Phase 4
 * adds thread parent bookkeeping (reply_count/latest_reply). Phase 5 adds
 * chat.update / chat.delete.
 */

import { postMessage } from "../../core/messages"
import { MinislackError } from "../../core/channels"
import { messageToMessageEvent } from "../../core/event-mappers"
import type { EventBus } from "../../core/events"
import type { Channel, Message, Workspace } from "../../types/slack"
import type { AuthContext } from "../auth"
import type { KnownBlock, Block } from "@slack/types"
import type { MessageAttachment } from "@slack/types"

export interface ChatPostMessageArgs {
  channel: string
  text?: string
  thread_ts?: string
  blocks?: (KnownBlock | Block)[]
  attachments?: MessageAttachment[]
  client_msg_id?: string
  /** Posted as this user_id (overrides the token's user for user-token callers only). */
  as_user?: string
}

export interface ChatPostMessageResponse {
  ok: true
  channel: string
  ts: string
  message: Message
}

export function chatPostMessage(
  ws: Workspace,
  bus: EventBus,
  ctx: AuthContext,
  args: ChatPostMessageArgs,
): ChatPostMessageResponse {
  const ch = resolve(ws, args.channel)
  if (ctx.kind === "app") {
    throw new MinislackError("not_authed", "chat.postMessage requires a user or bot token")
  }
  const userId = ctx.userId
  if (!userId) throw new MinislackError("not_authed")
  const msg = postMessage(ws, {
    channelId: ch.id,
    userId,
    text: args.text ?? "",
    blocks: args.blocks,
    attachments: args.attachments,
    thread_ts: args.thread_ts,
    client_msg_id: args.client_msg_id,
    ...(ctx.kind === "bot"
      ? { bot_id: ctx.botId, app_id: ctx.appId }
      : {}),
  })
  bus.publish(messageToMessageEvent(msg, ch))
  return { ok: true, channel: ch.id, ts: msg.ts, message: msg }
}

function resolve(ws: Workspace, idOrName: string): Channel {
  const direct = ws.channels.get(idOrName)
  if (direct) return direct
  const handle = idOrName.startsWith("#") ? idOrName.slice(1) : idOrName
  for (const ch of ws.channels.values()) {
    if ("name" in ch && ch.name === handle) return ch
  }
  throw new MinislackError("channel_not_found", idOrName)
}
