/**
 * Slack-compatible data model.
 *
 * Shapes mirror Slack's Web API responses so that a bantai Slack frontend
 * written against @slack/web-api unifies with minislack responses for free.
 * Where @slack/types has overly loose fields (lots of `any`/optional), we
 * narrow to what minislack actually populates.
 */

import type { KnownBlock, Block } from "@slack/types"
import type { MessageAttachment } from "@slack/types"

// ---------------------------------------------------------------------------
// Workspace / Team
// ---------------------------------------------------------------------------

export interface Workspace {
  team: Team
  users: Map<string, User>      // keyed by user id (U…/B…)
  apps: Map<string, App>         // keyed by app id (A…)
  channels: Map<string, Channel> // keyed by channel id (C…/G…/D…)
  files: Map<string, File>       // keyed by file id (F…)
  /** Monotonic per-channel timestamp state: channelId -> { lastUnix, seq }. */
  tsState: Map<string, { lastUnix: number; seq: number }>
  /** Deterministic counters for id minting, keyed by prefix. */
  idCounters: Map<string, number>
}

export interface Team {
  id: string           // T…
  name: string
  domain: string       // e.g. "acme" (sub-domain part of x.slack.com)
  url: string          // e.g. "https://acme.slack.com/"
}

// ---------------------------------------------------------------------------
// Users, Bots, Apps
// ---------------------------------------------------------------------------

export interface User {
  id: string           // U… (real users) or B… (bot users tied to an app)
  team_id: string
  name: string         // handle (no @)
  real_name: string
  is_bot: boolean
  /** For bot users, the app that owns them. */
  app_id?: string
  /** For bot users, the Bot record associated with that app. */
  bot_id?: string      // B…
  deleted: boolean
  profile: UserProfile
}

export interface UserProfile {
  real_name: string
  display_name: string
  email?: string
  image_24?: string
  image_32?: string
  image_48?: string
  image_72?: string
  image_192?: string
  image_512?: string
}

export interface Bot {
  id: string           // B…
  app_id: string       // A…
  user_id: string      // U… backing user (some apps don't have one; we always mint one for simplicity)
  name: string
  deleted: boolean
}

export interface App {
  id: string           // A…
  name: string
  scopes: string[]
  subscribed_events: string[]
  bot_id: string       // B…
  bot_user_id: string  // U… of the bot's user record
  tokens: {
    /** xoxb-… style bot token used by Web API calls. */
    bot: string
    /** xapp-… style app-level token used by apps.connections.open. */
    app: string
  }
}

// ---------------------------------------------------------------------------
// Channels (discriminated)
// ---------------------------------------------------------------------------

export type Channel =
  | PublicChannel
  | PrivateChannel
  | DirectMessage
  | MultiPartyIm

interface ChannelBase {
  id: string
  created: number       // unix seconds
  creator: string       // user id
  /** Ordered member ids. */
  members: string[]
  /** Message ts -> Message, sorted logically by ts ascending. */
  messages: Map<string, Message>
  /** ts of the last read position (not modeled per-user in v0). */
  last_read?: string
}

export interface PublicChannel extends ChannelBase {
  is_channel: true
  is_group: false
  is_im: false
  is_mpim: false
  is_private: false
  is_general: boolean
  is_archived: boolean
  name: string
  name_normalized: string
  topic: ChannelTopic
  purpose: ChannelPurpose
}

export interface PrivateChannel extends ChannelBase {
  is_channel: false
  is_group: true
  is_im: false
  is_mpim: false
  is_private: true
  is_archived: boolean
  name: string
  name_normalized: string
  topic: ChannelTopic
  purpose: ChannelPurpose
}

export interface DirectMessage extends ChannelBase {
  is_channel: false
  is_group: false
  is_im: true
  is_mpim: false
  is_private: true
  /** The other user id (for 1:1 DMs — members[] has exactly two). */
  user: string
  is_user_deleted: boolean
  is_open: boolean
}

export interface MultiPartyIm extends ChannelBase {
  is_channel: false
  is_group: false
  is_im: false
  is_mpim: true
  is_private: true
  name: string         // e.g. "mpdm-alice--bob--charlie-1"
  name_normalized: string
  is_open: boolean
}

export interface ChannelTopic {
  value: string
  creator: string
  last_set: number
}
export type ChannelPurpose = ChannelTopic

// ---------------------------------------------------------------------------
// Messages, Reactions, Files
// ---------------------------------------------------------------------------

export interface Message {
  type: "message"
  /** "<unixSec>.<seq6>", per-channel monotonic. */
  ts: string
  /** ts of the parent message if this is a thread reply. */
  thread_ts?: string
  /** true on the parent of a thread. */
  is_thread_parent?: boolean
  /** Reply count on the parent message. */
  reply_count?: number
  /** Array of reply user ids, parent-only. */
  reply_users?: string[]
  reply_users_count?: number
  /** ts of the most recent reply, parent-only. */
  latest_reply?: string
  channel: string
  user: string         // author user id
  /** Present when authored via a bot token. */
  bot_id?: string
  /** App that sent the message via a bot token. */
  app_id?: string
  text: string
  blocks?: (KnownBlock | Block)[]
  attachments?: MessageAttachment[]
  files?: File[]
  reactions?: Reaction[]
  edited?: { user: string; ts: string }
  /** "me_message", "bot_message", etc. Undefined for a plain user post. */
  subtype?: string
  /** Marker written on chat.delete — we keep the record so `ts` stays reserved. */
  tombstone?: boolean
  /** Client-side idempotency id; echoed back on post. */
  client_msg_id?: string
}

export interface Reaction {
  name: string
  count: number
  users: string[]      // user ids, insertion order
}

export interface File {
  id: string           // F…
  created: number      // unix seconds
  user: string         // uploader user id
  name: string
  title: string
  mimetype: string
  filetype: string     // "png", "jpg", "txt", ...
  pretty_type: string  // "PNG", "JPEG", ...
  size: number
  /** URL served by minislack's /files/:id. */
  url_private: string
  url_private_download: string
  /** Image files only: intrinsic pixel size when known. */
  original_w?: number
  original_h?: number
  /** Channels that have shared this file. */
  channels: string[]
  groups: string[]
  ims: string[]
}

// ---------------------------------------------------------------------------
// Event envelope — Socket Mode uses this shape around each Slack event.
// ---------------------------------------------------------------------------

export type SocketModeEnvelopeType =
  | "hello"
  | "events_api"
  | "slash_commands"
  | "interactive"
  | "disconnect"

export interface EventEnvelope<TPayload = unknown> {
  envelope_id: string
  type: SocketModeEnvelopeType
  accepts_response_payload: boolean
  payload: TPayload
  /** Present on redeliveries. */
  retry_attempt?: number
  retry_reason?: string
}

export interface EventsApiPayload<TEvent> {
  team_id: string
  api_app_id: string
  event: TEvent
  event_id: string
  event_time: number
  type: "event_callback"
}
