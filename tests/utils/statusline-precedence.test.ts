/**
 * getStatusLineConfig precedence rules.
 *
 * Claude's ~/.claude/settings.json is a *fallback* — any bantai-scoped
 * preference (cli / project / global) should win over it. This is the
 * user-facing promise: "edit .bantai/settings.json to take control".
 *
 * Specifically: a bantai-scoped `statusBar` must suppress a Claude-fallback
 * `statusLine`, otherwise the user's explicit native-preset choice is
 * silently overridden by whatever Claude Code's status line script does.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import path from "node:path"
import os from "node:os"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { getConfigPaths } from "../../src/config/settings"
import {
  getStatusLineConfig,
  invalidateStatusLineConfig,
} from "../../src/utils/statusline"

function makeTmpTree() {
  const root = path.join(
    os.tmpdir(),
    `bantai-statusline-prec-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  )
  const home = path.join(root, "home")
  mkdirSync(home, { recursive: true })
  return { root, home }
}

function writeJson(filePath: string, obj: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf-8")
}

let tmp: { root: string; home: string }
let prevHome: string | undefined

beforeEach(() => {
  tmp = makeTmpTree()
  prevHome = process.env.HOME
  process.env.HOME = tmp.home
  invalidateStatusLineConfig()
})

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME
  else process.env.HOME = prevHome
  invalidateStatusLineConfig()
  rmSync(tmp.root, { recursive: true, force: true })
})

describe("getStatusLineConfig — bantai > claude precedence", () => {
  it("returns claude-fallback statusLine when no bantai config exists", () => {
    // Only Claude config is set → use it (back-compat path).
    const paths = getConfigPaths({ home: tmp.home, cwd: tmp.home })
    writeJson(paths.claude, {
      statusLine: { type: "command", command: "echo from-claude" },
    })

    const cfg = getStatusLineConfig()
    expect(cfg).not.toBeNull()
    expect(cfg!.command).toBe("echo from-claude")
  })

  it("ignores claude-fallback statusLine when bantai global statusBar is set", () => {
    const paths = getConfigPaths({ home: tmp.home, cwd: tmp.home })
    writeJson(paths.claude, {
      statusLine: { type: "command", command: "echo from-claude" },
    })
    writeJson(paths.global, { statusBar: "minimal" })

    const cfg = getStatusLineConfig()
    // The user explicitly picked a native preset in bantai scope —
    // Claude-fallback must not override that choice.
    expect(cfg).toBeNull()
  })

  it("honors bantai-scoped statusLine even when statusBar is also set", () => {
    // User wants the external command AND a native preset as fallback:
    // bantai-scoped statusLine wins (explicit >>> inferred).
    const paths = getConfigPaths({ home: tmp.home, cwd: tmp.home })
    writeJson(paths.global, {
      statusLine: { type: "command", command: "echo from-bantai" },
      statusBar: "minimal",
    })

    const cfg = getStatusLineConfig()
    expect(cfg).not.toBeNull()
    expect(cfg!.command).toBe("echo from-bantai")
  })

  it("ignores claude-fallback statusLine when statusBar is only a default value (not explicit)", () => {
    // Edge case: user has no bantai config at all. statusBar source will be
    // "default", claude source is "claude-fallback". The claude-fallback
    // should be honored in that case (no explicit bantai preference).
    const paths = getConfigPaths({ home: tmp.home, cwd: tmp.home })
    writeJson(paths.claude, {
      statusLine: { type: "command", command: "echo from-claude" },
    })

    const cfg = getStatusLineConfig()
    expect(cfg).not.toBeNull()
    expect(cfg!.command).toBe("echo from-claude")
  })
})
