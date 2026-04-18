/**
 * Socket Mode envelope construction.
 *
 * Each Slack event sent over Socket Mode is wrapped in:
 *
 *   {
 *     envelope_id: <uuid>,
 *     type: "events_api" | "slash_commands" | "interactive" | "hello" | "disconnect",
 *     accepts_response_payload: boolean,
 *     payload: { team_id, api_app_id, event, event_id, event_time, type: "event_callback" }
 *   }
 *
 * The client acks with { envelope_id, payload: {} } — unacked envelopes
 * may be redelivered with `retry_attempt` + `retry_reason` set.
 */

import { randomUUID } from "node:crypto"
import type {
  EventEnvelope,
  EventsApiPayload,
  Workspace,
} from "../types/slack"
import type { SlackEvent } from "../types/events"

export function buildHello(): EventEnvelope<{ num_connections: number }> {
  return {
    envelope_id: randomUUID(),
    type: "hello",
    accepts_response_payload: false,
    payload: { num_connections: 1 },
  }
}

export function buildEventsApi(
  ws: Workspace,
  appId: string,
  evt: SlackEvent,
): EventEnvelope<EventsApiPayload<SlackEvent>> {
  const event_id = `Ev${Math.random().toString(36).slice(2, 10).toUpperCase()}`
  const event_time = Math.floor(Date.now() / 1000)
  return {
    envelope_id: randomUUID(),
    type: "events_api",
    accepts_response_payload: false,
    payload: {
      team_id: ws.team.id,
      api_app_id: appId,
      event: evt,
      event_id,
      event_time,
      type: "event_callback",
    },
  }
}
