import { describe, expect, test } from "bun:test"

import {
  compareTs,
  createPublicChannel,
  createUser,
  createWorkspace,
  listHistory,
  postMessage,
  resolveChannel,
  findUser,
  MinislackError,
  nextTs,
} from "../../src/minislack"

describe("core/ids", () => {
  test("mints deterministic, prefix-based ids", () => {
    const ws = createWorkspace({ teamName: "Acme" })
    const alice = createUser(ws, { name: "alice" })
    const bob = createUser(ws, { name: "bob" })
    expect(ws.team.id).toBe("T00000001")
    expect(alice.id).toBe("U00000001")
    expect(bob.id).toBe("U00000002")

    const general = createPublicChannel(ws, { name: "general", creator: alice.id, is_general: true })
    const random = createPublicChannel(ws, { name: "random", creator: alice.id })
    expect(general.id).toBe("C00000001")
    expect(random.id).toBe("C00000002")
  })
})

describe("core/ts", () => {
  test("strict monotonic per-channel ts under bursts in the same second", () => {
    const ws = createWorkspace()
    const now = () => 1_700_000_000_000 // frozen clock
    const a = nextTs(ws, "C1", now)
    const b = nextTs(ws, "C1", now)
    const c = nextTs(ws, "C1", now)
    expect(compareTs(a, b)).toBeLessThan(0)
    expect(compareTs(b, c)).toBeLessThan(0)
    expect(a).toBe("1700000000.000001")
    expect(c).toBe("1700000000.000003")
  })

  test("independent per-channel sequences", () => {
    const ws = createWorkspace()
    const now = () => 1_700_000_000_000
    const a1 = nextTs(ws, "C1", now)
    const a2 = nextTs(ws, "C1", now)
    const b1 = nextTs(ws, "C2", now)
    expect(a1.endsWith(".000001")).toBe(true)
    expect(a2.endsWith(".000002")).toBe(true)
    expect(b1.endsWith(".000001")).toBe(true)
  })

  test("resets sequence when the unix second advances", () => {
    const ws = createWorkspace()
    let now = 1_700_000_000_000
    const a = nextTs(ws, "C1", () => now)
    now = 1_700_000_001_000
    const b = nextTs(ws, "C1", () => now)
    expect(a).toBe("1700000000.000001")
    expect(b).toBe("1700000001.000001")
    expect(compareTs(a, b)).toBeLessThan(0)
  })
})

describe("core/workspace", () => {
  test("findUser resolves by id and by @handle", () => {
    const ws = createWorkspace()
    const alice = createUser(ws, { name: "alice" })
    expect(findUser(ws, alice.id)).toBe(alice)
    expect(findUser(ws, "alice")).toBe(alice)
    expect(findUser(ws, "@alice")).toBe(alice)
    expect(findUser(ws, "missing")).toBeUndefined()
  })
})

describe("core/channels", () => {
  test("creator is added to members automatically", () => {
    const ws = createWorkspace()
    const alice = createUser(ws, { name: "alice" })
    const general = createPublicChannel(ws, { name: "general", creator: alice.id })
    expect(general.members).toEqual([alice.id])
    expect(general.is_channel).toBe(true)
    expect(general.is_private).toBe(false)
  })

  test("resolveChannel accepts #name or id", () => {
    const ws = createWorkspace()
    const alice = createUser(ws, { name: "alice" })
    const general = createPublicChannel(ws, { name: "general", creator: alice.id })
    expect(resolveChannel(ws, "general")).toBe(general)
    expect(resolveChannel(ws, "#general")).toBe(general)
    expect(resolveChannel(ws, general.id)).toBe(general)
    expect(resolveChannel(ws, "ghost")).toBeUndefined()
  })

  test("rejects duplicate channel names", () => {
    const ws = createWorkspace()
    const alice = createUser(ws, { name: "alice" })
    createPublicChannel(ws, { name: "general", creator: alice.id })
    expect(() =>
      createPublicChannel(ws, { name: "general", creator: alice.id }),
    ).toThrow(MinislackError)
  })
})

describe("core/messages", () => {
  test("post + list round-trips with newest-first history", () => {
    const ws = createWorkspace()
    const alice = createUser(ws, { name: "alice" })
    const general = createPublicChannel(ws, { name: "general", creator: alice.id })

    let now = 1_700_000_000_000
    const m1 = postMessage(ws, { channelId: general.id, userId: alice.id, text: "hello", now: () => now })
    now += 500
    const m2 = postMessage(ws, { channelId: general.id, userId: alice.id, text: "world", now: () => now })
    now += 1_500
    const m3 = postMessage(ws, { channelId: general.id, userId: alice.id, text: "again", now: () => now })

    expect(compareTs(m1.ts, m2.ts)).toBeLessThan(0)
    expect(compareTs(m2.ts, m3.ts)).toBeLessThan(0)

    const history = listHistory(general)
    expect(history.messages.map((m) => m.text)).toEqual(["again", "world", "hello"])
    expect(history.has_more).toBe(false)
  })

  test("history supports oldest/latest/limit/inclusive bounds", () => {
    const ws = createWorkspace()
    const alice = createUser(ws, { name: "alice" })
    const general = createPublicChannel(ws, { name: "general", creator: alice.id })
    let t = 1_700_000_000_000
    const msgs = [0, 1, 2, 3, 4].map((i) => {
      const msg = postMessage(ws, {
        channelId: general.id,
        userId: alice.id,
        text: `m${i}`,
        now: () => t,
      })
      t += 1000
      return msg
    })
    const m1 = msgs[1]!
    const m3 = msgs[3]!

    const window = listHistory(general, { oldest: m1.ts, latest: m3.ts })
    expect(window.messages.map((m) => m.text)).toEqual(["m2"])

    const windowInclusive = listHistory(general, {
      oldest: m1.ts,
      latest: m3.ts,
      inclusive: true,
    })
    expect(windowInclusive.messages.map((m) => m.text)).toEqual(["m3", "m2", "m1"])

    const capped = listHistory(general, { limit: 2 })
    expect(capped.messages.map((m) => m.text)).toEqual(["m4", "m3"])
    expect(capped.has_more).toBe(true)
  })

  test("non-members cannot post", () => {
    const ws = createWorkspace()
    const alice = createUser(ws, { name: "alice" })
    const bob = createUser(ws, { name: "bob" })
    const general = createPublicChannel(ws, { name: "general", creator: alice.id })
    expect(() =>
      postMessage(ws, { channelId: general.id, userId: bob.id, text: "hi" }),
    ).toThrow(MinislackError)
  })

  test("empty text without blocks/attachments is rejected", () => {
    const ws = createWorkspace()
    const alice = createUser(ws, { name: "alice" })
    const general = createPublicChannel(ws, { name: "general", creator: alice.id })
    expect(() =>
      postMessage(ws, { channelId: general.id, userId: alice.id, text: "   " }),
    ).toThrow(MinislackError)
  })
})
