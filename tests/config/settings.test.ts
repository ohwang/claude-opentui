import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import path from "node:path"
import os from "node:os"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import {
  loadConfig,
  loadConfigSync,
  writeGlobalSetting,
  coerceSettingValue,
  getConfigPaths,
  DEFAULTS,
} from "../../src/config/settings"

/**
 * All tests run against throwaway homedir + cwd trees so we never touch
 * the user's real `~/.bantai` or project files.
 */

function makeTmpTree() {
  const root = path.join(os.tmpdir(), `bantai-settings-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const home = path.join(root, "home")
  const cwd = path.join(root, "proj")
  mkdirSync(home, { recursive: true })
  mkdirSync(cwd, { recursive: true })
  return { root, home, cwd }
}

function writeJson(filePath: string, obj: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf-8")
}

let tmp: { root: string; home: string; cwd: string }

beforeEach(() => {
  tmp = makeTmpTree()
})

afterEach(() => {
  rmSync(tmp.root, { recursive: true, force: true })
})

describe("loadConfig precedence", () => {
  it("returns defaults when no files exist", async () => {
    const cfg = await loadConfig({ home: tmp.home, cwd: tmp.cwd })
    expect(cfg.values.theme).toBe(DEFAULTS.theme)
    expect(cfg.values.debug).toBe(DEFAULTS.debug)
    expect(cfg.sources.theme).toBe("default")
    expect(cfg.scopes.project.exists).toBe(false)
    expect(cfg.scopes.global.exists).toBe(false)
    expect(cfg.scopes.claude.exists).toBe(false)
  })

  it("claude fallback wins when bantai scopes are missing", async () => {
    const paths = getConfigPaths({ home: tmp.home, cwd: tmp.cwd })
    writeJson(paths.claude, { statusLine: { type: "command", command: "echo hi" } })
    const cfg = await loadConfig({ home: tmp.home, cwd: tmp.cwd })
    expect(cfg.values.statusLine?.command).toBe("echo hi")
    expect(cfg.sources.statusLine).toBe("claude-fallback")
  })

  it("global bantai overrides claude fallback", async () => {
    const paths = getConfigPaths({ home: tmp.home, cwd: tmp.cwd })
    writeJson(paths.claude, { statusLine: { type: "command", command: "from-claude" } })
    writeJson(paths.global, { statusLine: { type: "command", command: "from-global" } })
    const cfg = await loadConfig({ home: tmp.home, cwd: tmp.cwd })
    expect(cfg.values.statusLine?.command).toBe("from-global")
    expect(cfg.sources.statusLine).toBe("global")
  })

  it("project overrides global", async () => {
    const paths = getConfigPaths({ home: tmp.home, cwd: tmp.cwd })
    writeJson(paths.global, { theme: "dracula" })
    writeJson(paths.project, { theme: "solarized-dark" })
    const cfg = await loadConfig({ home: tmp.home, cwd: tmp.cwd })
    expect(cfg.values.theme).toBe("solarized-dark")
    expect(cfg.sources.theme).toBe("project")
  })

  it("cli flags outrank every file", async () => {
    const paths = getConfigPaths({ home: tmp.home, cwd: tmp.cwd })
    writeJson(paths.global, { theme: "dracula" })
    writeJson(paths.project, { theme: "solarized-dark" })
    const cfg = await loadConfig({
      home: tmp.home,
      cwd: tmp.cwd,
      cliOverrides: { theme: "snazzy" },
    })
    expect(cfg.values.theme).toBe("snazzy")
    expect(cfg.sources.theme).toBe("cli")
  })
})

describe("loadConfig graceful failures", () => {
  it("warns (not throws) on malformed JSON and falls through", async () => {
    const paths = getConfigPaths({ home: tmp.home, cwd: tmp.cwd })
    mkdirSync(path.dirname(paths.global), { recursive: true })
    writeFileSync(paths.global, "{ this is not json ", "utf-8")
    writeJson(paths.claude, { theme: "high-contrast" })

    const cfg = await loadConfig({ home: tmp.home, cwd: tmp.cwd })
    // Falls through the broken global file and picks up claude fallback.
    expect(cfg.values.theme).toBe("high-contrast")
    expect(cfg.sources.theme).toBe("claude-fallback")
    expect(cfg.scopes.global.parsed).toBe(false)
    expect(cfg.scopes.global.error).toBeTruthy()
  })

  it("ignores non-object JSON (arrays, primitives)", async () => {
    const paths = getConfigPaths({ home: tmp.home, cwd: tmp.cwd })
    writeJson(paths.global, ["not", "an", "object"])
    const cfg = await loadConfig({ home: tmp.home, cwd: tmp.cwd })
    expect(cfg.values.theme).toBe(DEFAULTS.theme)
    expect(cfg.scopes.global.parsed).toBe(false)
  })

  it("treats empty files as valid but data-less", async () => {
    const paths = getConfigPaths({ home: tmp.home, cwd: tmp.cwd })
    mkdirSync(path.dirname(paths.global), { recursive: true })
    writeFileSync(paths.global, "", "utf-8")
    const cfg = await loadConfig({ home: tmp.home, cwd: tmp.cwd })
    expect(cfg.scopes.global.exists).toBe(true)
    expect(cfg.scopes.global.parsed).toBe(true)
    expect(cfg.values.theme).toBe(DEFAULTS.theme)
  })
})

describe("loadConfig array merge", () => {
  it("concatenates permissions across scopes and deduplicates", async () => {
    const paths = getConfigPaths({ home: tmp.home, cwd: tmp.cwd })
    writeJson(paths.claude, { permissions: ["read", "shared"] })
    writeJson(paths.global, { permissions: ["write", "shared"] })
    writeJson(paths.project, { permissions: ["exec"] })
    const cfg = await loadConfig({ home: tmp.home, cwd: tmp.cwd })
    // CLI (none) -> project -> global -> claude; dedupe preserves first-seen.
    expect(cfg.values.permissions).toEqual(["exec", "write", "shared", "read"])
  })

  it("merges mcpServers objects across scopes, higher priority wins on name conflict", async () => {
    const paths = getConfigPaths({ home: tmp.home, cwd: tmp.cwd })
    writeJson(paths.claude, { mcpServers: { shared: { cmd: "from-claude" }, onlyClaude: { cmd: "c" } } })
    writeJson(paths.global, { mcpServers: { shared: { cmd: "from-global" }, onlyGlobal: { cmd: "g" } } })
    const cfg = await loadConfig({ home: tmp.home, cwd: tmp.cwd })
    const servers = cfg.values.mcpServers as Record<string, { cmd: string }>
    expect(servers.shared?.cmd).toBe("from-global") // global wins over claude
    expect(servers.onlyClaude?.cmd).toBe("c")
    expect(servers.onlyGlobal?.cmd).toBe("g")
  })
})

describe("writeGlobalSetting", () => {
  it("creates ~/.bantai/settings.json and writes a key", async () => {
    const written = await writeGlobalSetting("theme", "dracula", { home: tmp.home })
    expect(written).toBe(path.join(tmp.home, ".bantai", "settings.json"))
    const cfg = await loadConfig({ home: tmp.home, cwd: tmp.cwd })
    expect(cfg.values.theme).toBe("dracula")
    expect(cfg.sources.theme).toBe("global")
  })

  it("preserves unrelated keys on rewrite", async () => {
    await writeGlobalSetting("theme", "dracula", { home: tmp.home })
    await writeGlobalSetting("vimMode", true, { home: tmp.home })
    const cfg = await loadConfig({ home: tmp.home, cwd: tmp.cwd })
    expect(cfg.values.theme).toBe("dracula")
    expect(cfg.values.vimMode).toBe(true)
  })
})

describe("loadConfigSync", () => {
  it("mirrors loadConfig precedence synchronously", () => {
    const paths = getConfigPaths({ home: tmp.home, cwd: tmp.cwd })
    writeJson(paths.global, { theme: "dracula", statusLine: { type: "command", command: "from-global" } })
    writeJson(paths.claude, { theme: "ignored", statusLine: { type: "command", command: "from-claude" } })
    const cfg = loadConfigSync({ home: tmp.home, cwd: tmp.cwd })
    expect(cfg.values.theme).toBe("dracula")
    expect(cfg.sources.theme).toBe("global")
    expect(cfg.values.statusLine?.command).toBe("from-global")
  })

  it("returns defaults when nothing is on disk", () => {
    const cfg = loadConfigSync({ home: tmp.home, cwd: tmp.cwd })
    expect(cfg.values.theme).toBe(DEFAULTS.theme)
    expect(cfg.sources.theme).toBe("default")
  })
})

describe("coerceSettingValue", () => {
  it("coerces booleans", () => {
    expect(coerceSettingValue("vimMode", "true")).toBe(true)
    expect(coerceSettingValue("vimMode", "1")).toBe(true)
    expect(coerceSettingValue("vimMode", "false")).toBe(false)
    expect(() => coerceSettingValue("vimMode", "sure")).toThrow()
  })

  it("validates backend enum", () => {
    expect(coerceSettingValue("backend", "claude")).toBe("claude")
    expect(() => coerceSettingValue("backend", "nope")).toThrow()
  })

  it("validates permissionMode enum", () => {
    expect(coerceSettingValue("permissionMode", "plan")).toBe("plan")
    expect(() => coerceSettingValue("permissionMode", "wild")).toThrow()
  })

  it("parses JSON for statusLine", () => {
    const v = coerceSettingValue("statusLine", '{"type":"command","command":"echo x"}') as { command: string }
    expect(v.command).toBe("echo x")
  })
})
