/**
 * Workspace fixtures for tests and `bantai minislack --fixture <name>`.
 *
 * Each fixture mutates a freshly-created Workspace in place. Deterministic
 * ordering → deterministic IDs → stable snapshots.
 */

import { createUser } from "../core/workspace"
import { createPublicChannel } from "../core/channels"
import { postMessage } from "../core/messages"
import type { Workspace } from "../types/slack"

export type FixtureName = "empty" | "basic" | "threaded" | "multi-user"

export function applyFixture(ws: Workspace, name: FixtureName): void {
  switch (name) {
    case "empty":
      return
    case "basic":
      return basic(ws)
    case "threaded":
      return threaded(ws)
    case "multi-user":
      return multiUser(ws)
  }
}

function basic(ws: Workspace): void {
  const alice = createUser(ws, { name: "alice", real_name: "Alice" })
  const bob = createUser(ws, { name: "bob", real_name: "Bob" })
  const general = createPublicChannel(ws, {
    name: "general",
    creator: alice.id,
    is_general: true,
    members: [alice.id, bob.id],
  })
  createPublicChannel(ws, {
    name: "random",
    creator: alice.id,
    members: [alice.id, bob.id],
  })
  let t = 1_700_000_000_000
  postMessage(ws, { channelId: general.id, userId: alice.id, text: "welcome to minislack!", now: () => t })
  t += 1000
  postMessage(ws, { channelId: general.id, userId: bob.id, text: "hi alice 👋", now: () => t })
}

function threaded(ws: Workspace): void {
  basic(ws)
  // Thread authoring lands in Phase 4; fixture is a placeholder for now.
}

function multiUser(ws: Workspace): void {
  const alice = createUser(ws, { name: "alice", real_name: "Alice" })
  const bob = createUser(ws, { name: "bob", real_name: "Bob" })
  const carol = createUser(ws, { name: "carol", real_name: "Carol" })
  const dave = createUser(ws, { name: "dave", real_name: "Dave" })
  const general = createPublicChannel(ws, {
    name: "general",
    creator: alice.id,
    is_general: true,
    members: [alice.id, bob.id, carol.id, dave.id],
  })
  createPublicChannel(ws, {
    name: "engineering",
    creator: alice.id,
    members: [alice.id, bob.id, carol.id],
  })
  createPublicChannel(ws, {
    name: "design",
    creator: alice.id,
    members: [alice.id, dave.id],
  })
  let t = 1_700_000_000_000
  for (const [author, text] of [
    [alice.id, "shipping minislack today"],
    [bob.id, "who's on call?"],
    [carol.id, "i got it"],
    [dave.id, "🎉"],
  ] as const) {
    postMessage(ws, { channelId: general.id, userId: author, text, now: () => t })
    t += 1000
  }
}
