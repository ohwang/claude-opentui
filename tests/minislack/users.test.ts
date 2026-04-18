/**
 * users.* Web API + multi-user/bot integration coverage (Phase 3 gate).
 *
 *   - users.list returns non-deleted humans + bot users.
 *   - users.info returns a full User, or user_not_found on missing id.
 *   - users.profile.get returns the UserProfile.
 *   - users.conversations returns the caller's (or a named user's) channels.
 *   - registerApp → human posts → app receives via Socket Mode → app replies
 *     with bot token → history shows the Slack-shape distinctions
 *     (bot_message subtype, bot_id, app_id on the bot reply; none on the
 *     user message).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import {
  startMinislack,
  type MinislackHandle,
} from "../../src/minislack/testing/harness"
import {
  createUser,
  deactivateUser,
  listUsers,
  updateUser,
} from "../../src/minislack/core/users"
import { createPublicChannel } from "../../src/minislack/core/channels"

interface AppEnvelope {
  envelope_id: string
  type: string
  accepts_response_payload: boolean
  payload: any
}

let handle: MinislackHandle

beforeEach(async () => {
  handle = await startMinislack({ port: 0, serveWeb: false })
  const alice = createUser(handle.workspace, { name: "alice", real_name: "Alice", email: "alice@example.com" })
  const bob = createUser(handle.workspace, { name: "bob", real_name: "Bob" })
  createPublicChannel(handle.workspace, {
    name: "general",
    creator: alice.id,
    is_general: true,
    members: [alice.id, bob.id],
  })
  createPublicChannel(handle.workspace, {
    name: "engineering",
    creator: alice.id,
    members: [alice.id],
  })
})

afterEach(async () => {
  await handle.stop()
})

// ---------------------------------------------------------------------------
// core/users — CRUD tests
// ---------------------------------------------------------------------------

describe("core/users", () => {
  test("updateUser patches name/real_name/email and mirrors into profile", () => {
    const ws = handle.workspace
    const alice = ws.users.get("U00000001")!
    const updated = updateUser(ws, alice.id, {
      real_name: "Alice Liddell",
      email: "alice@wonderland.io",
    })
    expect(updated).toBe(alice)
    expect(alice.real_name).toBe("Alice Liddell")
    expect(alice.profile.real_name).toBe("Alice Liddell")
    expect(alice.profile.email).toBe("alice@wonderland.io")
  })

  test("updateUser with a profile patch wins on overlapping fields", () => {
    const ws = handle.workspace
    const alice = ws.users.get("U00000001")!
    updateUser(ws, alice.id, {
      profile: { real_name: "A. L.", display_name: "lice", image_48: "/a48.png" },
    })
    expect(alice.real_name).toBe("A. L.")
    expect(alice.name).toBe("lice")
    expect(alice.profile.image_48).toBe("/a48.png")
  })

  test("deactivateUser soft-deletes (sets deleted: true)", () => {
    const ws = handle.workspace
    const bob = ws.users.get("U00000002")!
    expect(bob.deleted).toBe(false)
    const out = deactivateUser(ws, bob.id)
    expect(out).toBe(bob)
    expect(bob.deleted).toBe(true)
  })

  test("deactivateUser + updateUser on missing id return undefined", () => {
    const ws = handle.workspace
    expect(deactivateUser(ws, "U_nope")).toBeUndefined()
    expect(updateUser(ws, "U_nope", { name: "x" })).toBeUndefined()
  })

  test("listUsers filters by include_deleted + is_bot", () => {
    const ws = handle.workspace
    // Mint a bot user via registerApp so we have both kinds.
    const { botUser } = handle.registerApp({
      name: "test-bot",
      scopes: ["chat:write"],
      subscribed_events: ["message"],
    })
    const bob = ws.users.get("U00000002")!
    deactivateUser(ws, bob.id)

    const live = listUsers(ws)
    const liveIds = live.map((u) => u.id)
    expect(liveIds).toContain("U00000001") // alice
    expect(liveIds).toContain(botUser.id)
    expect(liveIds).not.toContain(bob.id)

    const withDeleted = listUsers(ws, { include_deleted: true })
    expect(withDeleted.map((u) => u.id)).toContain(bob.id)

    const bots = listUsers(ws, { is_bot: true })
    expect(bots.map((u) => u.id)).toEqual([botUser.id])

    const humans = listUsers(ws, { is_bot: false })
    expect(humans.map((u) => u.id)).toContain("U00000001")
    expect(humans.map((u) => u.id)).not.toContain(botUser.id)
  })
})

// ---------------------------------------------------------------------------
// Web API — users.*
// ---------------------------------------------------------------------------

describe("Web API — users.*", () => {
  test("users.list returns humans + bot users, excludes soft-deleted by default", async () => {
    const alice = handle.asUser("alice")
    const { botUser } = handle.registerApp({
      name: "watch-bot",
      scopes: ["chat:write"],
      subscribed_events: ["message"],
    })
    deactivateUser(handle.workspace, "U00000002") // bob

    const res = await fetch(`${handle.url}/api/users.list`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${alice.token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    })
    const body = (await res.json()) as any
    expect(body.ok).toBe(true)
    expect(body.response_metadata).toEqual({ next_cursor: "" })
    const ids: string[] = body.members.map((u: any) => u.id)
    expect(ids).toContain("U00000001") // alice
    expect(ids).toContain(botUser.id)
    expect(ids).not.toContain("U00000002") // bob soft-deleted
    // Sanity: bot user carries Slack-shape markers.
    const botEntry = body.members.find((u: any) => u.id === botUser.id)
    expect(botEntry.is_bot).toBe(true)
    expect(botEntry.app_id).toBeDefined()
    expect(botEntry.bot_id).toBeDefined()
  })

  test("users.list?include_deleted=true returns the soft-deleted user too", async () => {
    const alice = handle.asUser("alice")
    deactivateUser(handle.workspace, "U00000002")
    const res = await fetch(
      `${handle.url}/api/users.list?include_deleted=true`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${alice.token}` },
      },
    )
    const body = (await res.json()) as any
    expect(body.ok).toBe(true)
    expect(body.members.map((u: any) => u.id)).toContain("U00000002")
  })

  test("users.info returns a full User record", async () => {
    const alice = handle.asUser("alice")
    const res = await fetch(`${handle.url}/api/users.info`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${alice.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user: "U00000001" }),
    })
    const body = (await res.json()) as any
    expect(body.ok).toBe(true)
    expect(body.user.id).toBe("U00000001")
    expect(body.user.name).toBe("alice")
    expect(body.user.profile.email).toBe("alice@example.com")
  })

  test("users.info errors with user_not_found on missing id", async () => {
    const alice = handle.asUser("alice")
    const res = await fetch(`${handle.url}/api/users.info`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${alice.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user: "U_ghost" }),
    })
    const body = (await res.json()) as any
    expect(body.ok).toBe(false)
    expect(body.error).toBe("user_not_found")
  })

  test("users.profile.get returns the user profile", async () => {
    const alice = handle.asUser("alice")
    const res = await fetch(`${handle.url}/api/users.profile.get`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${alice.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user: "U00000001" }),
    })
    const body = (await res.json()) as any
    expect(body.ok).toBe(true)
    expect(body.profile.real_name).toBe("Alice")
    expect(body.profile.display_name).toBe("alice")
    expect(body.profile.email).toBe("alice@example.com")
  })

  test("users.profile.get defaults to the caller when `user` is omitted", async () => {
    const alice = handle.asUser("alice")
    const res = await fetch(`${handle.url}/api/users.profile.get`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${alice.token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    })
    const body = (await res.json()) as any
    expect(body.ok).toBe(true)
    expect(body.profile.display_name).toBe("alice")
  })

  test("users.conversations returns the caller's memberships by default", async () => {
    const alice = handle.asUser("alice")
    const res = await fetch(`${handle.url}/api/users.conversations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${alice.token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    })
    const body = (await res.json()) as any
    expect(body.ok).toBe(true)
    const names: string[] = body.channels
      .map((c: any) => c.name)
      .filter(Boolean)
    expect(names).toContain("general")
    expect(names).toContain("engineering")
  })

  test("users.conversations filters by the specified user id", async () => {
    const alice = handle.asUser("alice")
    const res = await fetch(`${handle.url}/api/users.conversations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${alice.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user: "U00000002" }), // bob — only in #general
    })
    const body = (await res.json()) as any
    expect(body.ok).toBe(true)
    const names: string[] = body.channels
      .map((c: any) => c.name)
      .filter(Boolean)
    expect(names).toContain("general")
    expect(names).not.toContain("engineering")
  })

  test("users.conversations errors with user_not_found on missing id", async () => {
    const alice = handle.asUser("alice")
    const res = await fetch(`${handle.url}/api/users.conversations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${alice.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user: "U_ghost" }),
    })
    const body = (await res.json()) as any
    expect(body.ok).toBe(false)
    expect(body.error).toBe("user_not_found")
  })
})

// ---------------------------------------------------------------------------
// Integration — bot vs human Slack-shape distinctions on the wire.
// ---------------------------------------------------------------------------

describe("integration — multi-user + bot", () => {
  test("bot_message vs user message carry the correct Slack shape in history", async () => {
    const app = handle.registerApp({
      name: "shape-bot",
      scopes: ["chat:write"],
      subscribed_events: ["message"],
    })
    expect(app.botToken.startsWith("xoxb-")).toBe(true)
    expect(app.appToken.startsWith("xapp-")).toBe(true)

    // Add the bot user to #general so it can post.
    const general = handle.workspace.channels.get("C00000001")
    if (!general) throw new Error("fixture missing #general")
    general.members.push(app.botUser.id)

    // Open Socket Mode.
    const openRes = await fetch(`${handle.url}/api/apps.connections.open`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${app.appToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    })
    const openBody = (await openRes.json()) as any
    expect(openBody.ok).toBe(true)

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

    // Human posts.
    const alice = handle.asUser("alice")
    await alice.sendMessage("general", "hey bot")

    // Wait for the envelope, ack it.
    await waitFor(
      () =>
        received.some(
          (e) => e.type === "events_api" && e.payload?.event?.type === "message",
        ),
      1000,
    )
    const evt = received.find((e) => e.type === "events_api")!
    sock.send(JSON.stringify({ envelope_id: evt.envelope_id, payload: {} }))

    // Bot replies.
    const replyRes = await fetch(`${handle.url}/api/chat.postMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${app.botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel: "general", text: "hi alice" }),
    })
    const replyBody = (await replyRes.json()) as any
    expect(replyBody.ok).toBe(true)

    // History asserts the Slack-shape distinctions.
    const history = await alice.history("general")
    expect(history.length).toBe(2)
    const [botMsg, humanMsg] = history // newest-first
    expect(botMsg!.text).toBe("hi alice")
    expect(botMsg!.user).toBe(app.botUser.id)
    expect(botMsg!.subtype).toBe("bot_message")
    expect(botMsg!.bot_id).toBe(app.bot.id)
    expect(botMsg!.app_id).toBe(app.app.id)

    expect(humanMsg!.text).toBe("hey bot")
    expect(humanMsg!.user).toBe(alice.user.id)
    expect(humanMsg!.subtype).toBeUndefined()
    expect(humanMsg!.bot_id).toBeUndefined()
    expect(humanMsg!.app_id).toBeUndefined()

    sock.close()
  })

  test("auth.test distinguishes user vs bot token identities", async () => {
    const app = handle.registerApp({
      name: "auth-bot",
      scopes: ["chat:write"],
      subscribed_events: ["message"],
    })
    const alice = handle.asUser("alice")

    const userRes = await fetch(`${handle.url}/api/auth.test`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${alice.token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    })
    const userBody = (await userRes.json()) as any
    expect(userBody.ok).toBe(true)
    expect(userBody.user).toBe("alice")
    expect(userBody.bot_id).toBeUndefined()

    const botRes = await fetch(`${handle.url}/api/auth.test`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${app.botToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    })
    const botBody = (await botRes.json()) as any
    expect(botBody.ok).toBe(true)
    expect(botBody.user_id).toBe(app.botUser.id)
    expect(botBody.bot_id).toBe(app.bot.id)
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
