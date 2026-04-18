/**
 * Roundtrip — the compatibility-contract test.
 *
 * 1. Start an ephemeral minislack with the `basic` fixture.
 * 2. Register a fake Slack app, grab its tokens.
 * 3. Connect over Socket Mode WebSocket, wait for `hello`.
 * 4. A user posts a message via chat.postMessage.
 * 5. The app receives a `message` envelope. It acks.
 * 6. The app posts a reply via chat.postMessage with its bot token.
 * 7. conversations.history shows both messages.
 *
 * If this stays green the Slack frontend will work against real Slack when
 * the base URL is swapped.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { startMinislack, type MinislackHandle } from "../../src/minislack/testing/harness"
import { createPublicChannel } from "../../src/minislack/core/channels"
import { createUser } from "../../src/minislack/core/workspace"
import { postMessage } from "../../src/minislack/core/messages"
import { messageToMessageEvent } from "../../src/minislack/core/event-mappers"

interface AppEnvelope {
  envelope_id: string
  type: string
  accepts_response_payload: boolean
  payload: any
}

let handle: MinislackHandle

beforeEach(async () => {
  handle = await startMinislack({ port: 0, serveWeb: false })
  // Seed a workspace minimally — the roundtrip test drives everything via the API.
  const alice = createUser(handle.workspace, { name: "alice", real_name: "Alice" })
  createPublicChannel(handle.workspace, {
    name: "general",
    creator: alice.id,
    is_general: true,
    members: [alice.id],
  })
})

afterEach(async () => {
  await handle.stop()
})

describe("Web API", () => {
  test("auth.test returns caller identity for a user token", async () => {
    const alice = handle.asUser("alice")
    const res = await fetch(`${handle.url}/api/auth.test`, {
      method: "POST",
      headers: { Authorization: `Bearer ${alice.token}`, "Content-Type": "application/json" },
      body: "{}",
    })
    const body = (await res.json()) as any
    expect(body.ok).toBe(true)
    expect(body.user).toBe("alice")
    expect(body.user_id).toBe(alice.user.id)
    expect(body.team_id).toBe(handle.workspace.team.id)
  })

  test("invalid token → ok:false, error:invalid_auth", async () => {
    const res = await fetch(`${handle.url}/api/auth.test`, {
      method: "POST",
      headers: { Authorization: "Bearer xoxp-U99999999", "Content-Type": "application/json" },
      body: "{}",
    })
    const body = (await res.json()) as any
    expect(body.ok).toBe(false)
    expect(body.error).toBe("invalid_auth")
  })

  test("chat.postMessage → conversations.history round-trips", async () => {
    const alice = handle.asUser("alice")
    const posted = await alice.sendMessage("general", "hello world")
    expect(posted.text).toBe("hello world")
    expect(posted.ts).toBeDefined()

    const history = await alice.history("general")
    expect(history.length).toBe(1)
    expect(history[0]!.text).toBe("hello world")
  })

  test("conversations.list returns the seeded channel", async () => {
    const alice = handle.asUser("alice")
    const res = await fetch(`${handle.url}/api/conversations.list?types=public_channel`, {
      method: "GET",
      headers: { Authorization: `Bearer ${alice.token}` },
    })
    const body = (await res.json()) as any
    expect(body.ok).toBe(true)
    expect(body.channels.map((c: any) => c.name)).toContain("general")
  })
})

describe("Socket Mode", () => {
  test("apps.connections.open + hello envelope + events_api delivery + ack + bot reply", async () => {
    // 1. Register the app
    const app = handle.registerApp({
      name: "test-bot",
      scopes: ["chat:write"],
      subscribed_events: ["message"],
    })
    expect(app.botToken.startsWith("xoxb-")).toBe(true)
    expect(app.appToken.startsWith("xapp-")).toBe(true)

    // Add the app's bot user to #general so it can post
    const general = handle.workspace.channels.get("C00000001")
    if (!general) throw new Error("fixture missing #general")
    general.members.push(app.botUser.id)

    // 2. apps.connections.open → WS URL
    const openRes = await fetch(`${handle.url}/api/apps.connections.open`, {
      method: "POST",
      headers: { Authorization: `Bearer ${app.appToken}`, "Content-Type": "application/json" },
      body: "{}",
    })
    const openBody = (await openRes.json()) as any
    expect(openBody.ok).toBe(true)
    expect(openBody.url).toContain("/link/")

    // 3. Connect the WS and wait for hello
    const sock = new WebSocket(openBody.url)
    const received: AppEnvelope[] = []
    const helloReceived = new Promise<void>((resolve) => {
      sock.addEventListener("message", (msg) => {
        const ev = JSON.parse(String(msg.data)) as AppEnvelope
        received.push(ev)
        if (ev.type === "hello") resolve()
      })
    })
    await new Promise<void>((resolve, reject) => {
      sock.addEventListener("open", () => resolve())
      sock.addEventListener("error", (e) => reject(e))
    })
    await helloReceived

    // 4. Alice posts a message
    const alice = handle.asUser("alice")
    await alice.sendMessage("general", "hi bot")

    // 5. App receives the message envelope
    await waitFor(() => received.some((e) => e.type === "events_api" && e.payload?.event?.type === "message"), 1000)
    const evt = received.find((e) => e.type === "events_api")!
    expect(evt.payload.event.text).toBe("hi bot")
    expect(evt.payload.event.user).toBe(alice.user.id)
    expect(evt.payload.team_id).toBe(handle.workspace.team.id)
    expect(evt.payload.api_app_id).toBe(app.app.id)

    // Ack the envelope
    sock.send(JSON.stringify({ envelope_id: evt.envelope_id, payload: {} }))

    // 6. Bot replies via chat.postMessage with its bot token
    const replyRes = await fetch(`${handle.url}/api/chat.postMessage`, {
      method: "POST",
      headers: { Authorization: `Bearer ${app.botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "general", text: "hello alice, bot here" }),
    })
    const replyBody = (await replyRes.json()) as any
    expect(replyBody.ok).toBe(true)
    expect(replyBody.message.user).toBe(app.botUser.id)
    expect(replyBody.message.bot_id).toBe(app.bot.id)

    // 7. History has both messages in order
    const history = await alice.history("general")
    expect(history.map((m) => m.text)).toEqual([
      "hello alice, bot here",
      "hi bot",
    ])

    sock.close()
  })
})

describe("event mapping", () => {
  test("messageToMessageEvent shape matches Slack's GenericMessageEvent", () => {
    const ws = handle.workspace
    const alice = createUser(ws, { name: "eve" })
    const ch = createPublicChannel(ws, { name: "eng", creator: alice.id, members: [alice.id] })
    const msg = postMessage(ws, { channelId: ch.id, userId: alice.id, text: "ping" })
    const evt = messageToMessageEvent(msg, ch)
    expect(evt.type).toBe("message")
    expect(evt.ts).toBe(msg.ts)
    expect(evt.event_ts).toBe(msg.ts)
    expect(evt.channel).toBe(ch.id)
    expect(evt.channel_type).toBe("channel")
    expect(evt.user).toBe(alice.id)
    expect(evt.text).toBe("ping")
    expect(evt.subtype).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------

async function waitFor(pred: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("timeout waiting for condition")
    await new Promise((r) => setTimeout(r, 10))
  }
}
