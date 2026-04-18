/**
 * chat.postMessage — post a message as the authed principal.
 *
 * Phase 1: plaintext + thread_ts + blocks/attachments passthrough. Phase 4
 * adds thread parent bookkeeping (reply_count/latest_reply). Phase 5 adds
 * chat.update / chat.delete.
 */

import { postMessageDetailed } from "../../core/messages"
import { MinislackError } from "../../core/channels"
import { channelTypeOf, messageToMessageEvent } from "../../core/event-mappers"
import type { EventBus } from "../../core/events"
import type { Channel, Message, Workspace } from "../../types/slack"
import type { MessageChangedEvent } from "../../types/events"
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
  const { message: msg, threadParent } = postMessageDetailed(ws, {
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
  if (threadParent) {
    bus.publish(buildThreadParentChanged(threadParent, ch))
  }
  return { ok: true, channel: ch.id, ts: msg.ts, message: msg }
}

/**
 * Emit a message_changed event for the thread parent when reply count updates.
 * Slack does this so clients can refresh their "N replies" badge without
 * refetching the whole channel.
 */
function buildThreadParentChanged(parent: Message, ch: Channel): MessageChangedEvent {
  return {
    type: "message",
    subtype: "message_changed",
    event_ts: parent.latest_reply ?? parent.ts,
    ts: parent.latest_reply ?? parent.ts,
    channel: parent.channel,
    channel_type: channelTypeOf(ch),
    message: {
      type: "message",
      user: parent.user,
      text: parent.text,
      ts: parent.ts,
      ...(parent.edited ? { edited: parent.edited } : {}),
      ...(parent.blocks ? { blocks: parent.blocks } : {}),
      ...(parent.attachments ? { attachments: parent.attachments } : {}),
      ...(parent.thread_ts ? { thread_ts: parent.thread_ts } : {}),
      ...(parent.reply_count !== undefined ? { reply_count: parent.reply_count } : {}),
      ...(parent.reply_users ? { reply_users: parent.reply_users } : {}),
      ...(parent.reply_users_count !== undefined ? { reply_users_count: parent.reply_users_count } : {}),
      ...(parent.latest_reply ? { latest_reply: parent.latest_reply } : {}),
    },
    previous_message: {
      type: "message",
      user: parent.user,
      text: parent.text,
      ts: parent.ts,
    },
    hidden: true,
  }
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
