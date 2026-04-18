/**
 * Reactions — add, remove, list.
 *
 * Stored on the Message as `reactions: Reaction[]`, where each Reaction
 * is `{ name, count, users[] }`. Users list keeps insertion order so
 * "first reacted by" renders consistently.
 */

import { MinislackError } from "./channels"
import type { Message, Reaction, Workspace } from "../types/slack"

export interface ReactionOpts {
  channelId: string
  ts: string
  userId: string
  name: string
}

export interface ReactionChangeResult {
  message: Message
  reaction: Reaction | undefined
  changed: boolean
}

export function addReaction(ws: Workspace, opts: ReactionOpts): ReactionChangeResult {
  const msg = resolveMessage(ws, opts.channelId, opts.ts)
  const reactions = msg.reactions ?? []
  let reaction = reactions.find((r) => r.name === opts.name)
  if (!reaction) {
    reaction = { name: opts.name, count: 0, users: [] }
    reactions.push(reaction)
  }
  if (reaction.users.includes(opts.userId)) {
    msg.reactions = reactions
    return { message: msg, reaction, changed: false }
  }
  reaction.users.push(opts.userId)
  reaction.count = reaction.users.length
  msg.reactions = reactions
  return { message: msg, reaction, changed: true }
}

export function removeReaction(ws: Workspace, opts: ReactionOpts): ReactionChangeResult {
  const msg = resolveMessage(ws, opts.channelId, opts.ts)
  const reactions = msg.reactions ?? []
  const reaction = reactions.find((r) => r.name === opts.name)
  if (!reaction || !reaction.users.includes(opts.userId)) {
    return { message: msg, reaction, changed: false }
  }
  reaction.users = reaction.users.filter((u) => u !== opts.userId)
  reaction.count = reaction.users.length
  if (reaction.count === 0) {
    msg.reactions = reactions.filter((r) => r.name !== opts.name)
    if (msg.reactions.length === 0) delete msg.reactions
  } else {
    msg.reactions = reactions
  }
  return { message: msg, reaction, changed: true }
}

export interface GetReactionsOpts {
  channelId: string
  ts: string
  /** Include full user list (Slack flag `full: true`). Default true for a fake. */
  full?: boolean
}

export function getReactions(ws: Workspace, opts: GetReactionsOpts): Reaction[] {
  const msg = resolveMessage(ws, opts.channelId, opts.ts)
  return msg.reactions ?? []
}

function resolveMessage(ws: Workspace, channelId: string, ts: string): Message {
  const ch = ws.channels.get(channelId)
  if (!ch) throw new MinislackError("channel_not_found", channelId)
  const msg = ch.messages.get(ts)
  if (!msg || msg.tombstone) throw new MinislackError("message_not_found", ts)
  return msg
}
