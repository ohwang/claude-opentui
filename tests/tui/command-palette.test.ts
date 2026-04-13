import { describe, expect, it } from "bun:test"
import {
  buildPaletteItems,
  truncate,
  type PaletteItem,
} from "../../src/tui/components/command-palette"
import { CommandRegistry, type SlashCommand } from "../../src/commands/registry"

// ---------------------------------------------------------------------------
// truncate
// ---------------------------------------------------------------------------

describe("truncate", () => {
  it("returns input unchanged when short enough", () => {
    expect(truncate("hello", 10)).toBe("hello")
  })

  it("truncates with ellipsis when over width", () => {
    expect(truncate("hello world", 8)).toBe("hello...")
  })

  it("returns empty string for non-positive width", () => {
    expect(truncate("hi", 0)).toBe("")
    expect(truncate("hi", -3)).toBe("")
  })

  it("does not add ellipsis when width leaves no room for it", () => {
    expect(truncate("hello", 3)).toBe("hel")
  })
})

// ---------------------------------------------------------------------------
// buildPaletteItems
// ---------------------------------------------------------------------------

function cmd(name: string, description: string, aliases?: string[]): SlashCommand {
  return { name, description, aliases, execute: () => {} }
}

function makeRegistry(commands: SlashCommand[]): CommandRegistry {
  const r = new CommandRegistry()
  for (const c of commands) r.register(c)
  return r
}

describe("buildPaletteItems", () => {
  it("returns all commands for an empty query", () => {
    const r = makeRegistry([
      cmd("model", "Switch model"),
      cmd("help", "Show help"),
    ])
    const items = buildPaletteItems(r, "")
    expect(items).toHaveLength(2)
    expect(items.every((i) => i.kind === "command")).toBe(true)
  })

  it("filters commands by name prefix (ranked first)", () => {
    const r = makeRegistry([
      cmd("model", "Switch model"),
      cmd("mode-lite", "Lite mode"),
      cmd("clear", "Clear the screen"),
    ])
    const items = buildPaletteItems(r, "mod")
    const names = items.map((i) => (i.kind === "command" ? i.cmd.name : ""))
    expect(names).toContain("model")
    expect(names).toContain("mode-lite")
    expect(names).not.toContain("clear")
  })

  it("matches commands by description when name does not match", () => {
    const r = makeRegistry([
      cmd("hotkeys", "Show keyboard shortcuts"),
      cmd("help", "Show help"),
    ])
    const items = buildPaletteItems(r, "keyboard")
    const names = items
      .filter((i) => i.kind === "command")
      .map((i) => (i as { kind: "command"; cmd: SlashCommand }).cmd.name)
    expect(names).toEqual(["hotkeys"])
  })

  it("appends action items after commands when they match the query", () => {
    const r = makeRegistry([cmd("model", "Switch model")])
    const extras: PaletteItem[] = [
      { kind: "action", label: "Theme: dark", description: "apply dark theme", run: () => {} },
      { kind: "action", label: "Theme: light", description: "apply light theme", run: () => {} },
    ]
    const items = buildPaletteItems(r, "dark", extras)
    expect(items).toHaveLength(1)
    expect(items[0]!.kind).toBe("action")
    expect((items[0] as { kind: "action"; label: string }).label).toBe("Theme: dark")
  })

  it("includes all action items when query is empty", () => {
    const r = makeRegistry([cmd("help", "Show help")])
    const extras: PaletteItem[] = [
      { kind: "action", label: "Quick toggle", run: () => {} },
    ]
    const items = buildPaletteItems(r, "", extras)
    expect(items.map((i) => i.kind)).toEqual(["command", "action"])
  })

  it("orders commands before actions", () => {
    const r = makeRegistry([cmd("theme", "Change theme")])
    const extras: PaletteItem[] = [
      { kind: "action", label: "theme quick", description: "quick theme toggle", run: () => {} },
    ]
    const items = buildPaletteItems(r, "theme", extras)
    expect(items[0]!.kind).toBe("command")
    expect(items[1]!.kind).toBe("action")
  })
})

// ---------------------------------------------------------------------------
// Invocation shape — documents the contract the app.tsx wiring relies on.
// ---------------------------------------------------------------------------

describe("PaletteItem invocation contract", () => {
  it("command items carry the SlashCommand for the caller to dispatch", () => {
    const r = makeRegistry([cmd("model", "Switch model", ["m"])])
    const items = buildPaletteItems(r, "model")
    const first = items[0]
    expect(first?.kind).toBe("command")
    if (first?.kind === "command") {
      expect(first.cmd.name).toBe("model")
      expect(first.cmd.aliases).toEqual(["m"])
    }
  })

  it("action items carry a run() callback that the caller invokes", () => {
    let fired = 0
    const extras: PaletteItem[] = [
      { kind: "action", label: "Toggle thing", run: () => { fired++ } },
    ]
    const items = buildPaletteItems(new CommandRegistry(), "", extras)
    const first = items[0]
    expect(first?.kind).toBe("action")
    if (first?.kind === "action") {
      first.run()
      expect(fired).toBe(1)
    }
  })
})
