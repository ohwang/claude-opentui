/**
 * Tests for /settings slash command.
 *
 * These exercise the command surface end-to-end against throwaway home
 * directories so `writeGlobalSetting` never touches the real `~/.bantai`.
 * The command still resolves `~/.bantai/settings.json` via its own loader
 * call, so `HOME` is swapped in/out per test.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import path from "node:path"
import os from "node:os"
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs"
import { settingsCommand } from "../../src/commands/builtin/settings"
import type { CommandContext } from "../../src/commands/registry"

function createMockContext() {
  const events: { type: string; text?: string; ephemeral?: boolean }[] = []
  const ctx: CommandContext = {
    backend: {} as any,
    pushEvent: (event: any) => events.push(event),
    clearConversation: () => {},
    resetCost: () => {},
    resetSession: async () => {},
    setModel: async () => {},
  }
  return { ctx, events }
}

let tmpHome: string
let realHome: string | undefined

beforeEach(() => {
  tmpHome = path.join(os.tmpdir(), `bantai-settings-cmd-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(tmpHome, { recursive: true })
  realHome = process.env.HOME
  process.env.HOME = tmpHome
})

afterEach(() => {
  if (realHome) process.env.HOME = realHome
  else delete process.env.HOME
  rmSync(tmpHome, { recursive: true, force: true })
})

describe("/settings command", () => {
  it("has correct metadata and no alias conflict", () => {
    expect(settingsCommand.name).toBe("settings")
    // Must NOT alias to /config — that would collide with the /settings command.
    expect(settingsCommand.aliases ?? []).not.toContain("config")
  })

  it("lists all settings with source provenance", async () => {
    const { ctx, events } = createMockContext()
    await settingsCommand.execute("", ctx)
    expect(events).toHaveLength(1)
    const text = events[0]!.text!
    expect(text).toContain("Settings")
    expect(text).toContain("theme:")
    expect(text).toContain("[default]")
    expect(text).toContain("Scope paths:")
    expect(text).toContain(path.join(tmpHome, ".bantai", "settings.json"))
  })

  it("shows detail for a single key", async () => {
    const { ctx, events } = createMockContext()
    await settingsCommand.execute("theme", ctx)
    expect(events).toHaveLength(1)
    const text = events[0]!.text!
    expect(text).toContain("theme")
    expect(text).toContain("source:")
  })

  it("rejects unknown keys in detail view", async () => {
    const { ctx, events } = createMockContext()
    await settingsCommand.execute("bogusKey", ctx)
    expect(events).toHaveLength(1)
    expect(events[0]!.text).toContain("Unknown setting: bogusKey")
  })

  it("rejects malformed `set` invocations", async () => {
    const { ctx, events } = createMockContext()
    await settingsCommand.execute("set vimMode", ctx)
    expect(events).toHaveLength(1)
    expect(events[0]!.text).toContain("Usage: /settings set")
  })

  it("rejects `set` with unknown keys", async () => {
    const { ctx, events } = createMockContext()
    await settingsCommand.execute("set bogus true", ctx)
    expect(events).toHaveLength(1)
    expect(events[0]!.text).toContain("Unknown setting: bogus")
  })

  it("rejects `set` with invalid value (type coercion fails)", async () => {
    const { ctx, events } = createMockContext()
    await settingsCommand.execute("set vimMode maybe", ctx)
    expect(events).toHaveLength(1)
    expect(events[0]!.text).toContain("Invalid value")
  })

  it("writes a valid setting to ~/.bantai/settings.json", async () => {
    const { ctx, events } = createMockContext()
    await settingsCommand.execute("set vimMode true", ctx)
    expect(events).toHaveLength(1)
    expect(events[0]!.text).toContain("Set vimMode = true")
    const file = path.join(tmpHome, ".bantai", "settings.json")
    const onDisk = JSON.parse(readFileSync(file, "utf-8"))
    expect(onDisk.vimMode).toBe(true)
  })

  it("round-trips value into subsequent listing", async () => {
    const { ctx: ctx1 } = createMockContext()
    await settingsCommand.execute("set vimMode true", ctx1)
    const { ctx: ctx2, events } = createMockContext()
    await settingsCommand.execute("", ctx2)
    const text = events[0]!.text!
    expect(text).toContain("vimMode: true")
    expect(text).toContain("[global]")
  })

  it("does not crash on malformed global settings file", async () => {
    mkdirSync(path.join(tmpHome, ".bantai"), { recursive: true })
    writeFileSync(path.join(tmpHome, ".bantai", "settings.json"), "{ not json", "utf-8")
    const { ctx, events } = createMockContext()
    await settingsCommand.execute("", ctx)
    expect(events).toHaveLength(1)
    const text = events[0]!.text!
    expect(text).toContain("global parse error")
  })
})
