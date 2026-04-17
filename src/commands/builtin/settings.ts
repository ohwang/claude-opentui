/**
 * /settings — view + edit persistent bantai settings.
 *
 * Backed by `src/config/settings.ts`, which resolves values from (in priority
 * order) CLI flags → `.bantai/settings.json` (project) → `~/.bantai/settings.json`
 * (global) → `~/.claude/settings.json` (read-only fallback) → built-in defaults.
 *
 * Usage:
 *   /settings                      — list every setting with its current
 *                                    value and source (cli/project/global/
 *                                    claude-fallback/default).
 *   /settings <key>                — show detail for a single setting, plus
 *                                    the full scope file paths.
 *   /settings set <key> <value>    — write `<key>` to `~/.bantai/settings.json`.
 *                                    Applied in-memory for the remainder of
 *                                    this session; persisted for future runs.
 *
 * This command surfaces inline ephemeral system messages — no TUI panels.
 */

import type { SlashCommand } from "../registry"
import {
  loadConfig,
  writeGlobalSetting,
  coerceSettingValue,
  formatSettingValue,
  type BantaiConfig,
  type ResolvedConfig,
  type SettingSource,
} from "../../config/settings"
import { invalidateStatusLineConfig } from "../../utils/statusline"
import { applyTheme, getCurrentThemeId } from "../../tui/theme/tokens"
import { getTheme } from "../../tui/theme/registry"
import { applyStatusBar, getCurrentStatusBarId } from "../../tui/status-bar/active"
import { getStatusBar } from "../../tui/status-bar/registry"

// Every user-facing key we render in `/settings`. Keep in sync with
// BantaiConfig — missing keys here are simply not shown.
const DISPLAY_KEYS: Array<keyof BantaiConfig> = [
  "theme",
  "statusBar",
  "model",
  "backend",
  "permissionMode",
  "statusLine",
  "vimMode",
  "showCost",
  "showTokens",
  "debug",
  "permissions",
  "mcpServers",
]

const SOURCE_LABELS: Record<SettingSource, string> = {
  cli: "cli flag",
  project: "project",
  global: "global",
  "claude-fallback": "claude-fallback",
  default: "default",
}

function renderList(resolved: ResolvedConfig): string {
  const lines: string[] = ["Settings", ""]
  for (const key of DISPLAY_KEYS) {
    const value = (resolved.values as Record<string, unknown>)[key]
    const source = resolved.sources[key] ?? "default"
    lines.push(`  ${key}: ${formatSettingValue(value)}  [${SOURCE_LABELS[source]}]`)
  }
  lines.push("")
  lines.push(`Scope paths:`)
  lines.push(`  project: ${resolved.scopes.project.path}${resolved.scopes.project.exists ? "" : " (missing)"}`)
  lines.push(`  global:  ${resolved.scopes.global.path}${resolved.scopes.global.exists ? "" : " (missing)"}`)
  lines.push(`  claude:  ${resolved.scopes.claude.path}${resolved.scopes.claude.exists ? "" : " (missing)"}`)
  if (!resolved.scopes.global.parsed && resolved.scopes.global.error) {
    lines.push(`  ! global parse error: ${resolved.scopes.global.error}`)
  }
  if (!resolved.scopes.project.parsed && resolved.scopes.project.error) {
    lines.push(`  ! project parse error: ${resolved.scopes.project.error}`)
  }
  if (!resolved.scopes.claude.parsed && resolved.scopes.claude.error) {
    lines.push(`  ! claude parse error: ${resolved.scopes.claude.error}`)
  }
  lines.push("")
  lines.push(`Edit: /settings set <key> <value>`)
  return lines.join("\n")
}

function renderDetail(resolved: ResolvedConfig, key: keyof BantaiConfig): string {
  const value = (resolved.values as Record<string, unknown>)[key]
  const source = resolved.sources[key] ?? "default"
  const lines = [
    `${key}`,
    `  value:  ${formatSettingValue(value)}`,
    `  source: ${SOURCE_LABELS[source]}`,
  ]
  return lines.join("\n")
}

/**
 * Apply the in-memory side effects of a setting change for the current
 * session. The on-disk write has already happened by the time this is called.
 */
function applyInMemory(key: keyof BantaiConfig, value: unknown): string | null {
  switch (key) {
    case "theme": {
      if (typeof value !== "string") return null
      const theme = getTheme(value)
      if (!theme) return `Theme "${value}" written to disk but not found in registry; will take effect when registered.`
      if (value === getCurrentThemeId()) return null
      applyTheme(theme)
      return `Theme applied: ${theme.name}.`
    }
    case "statusLine": {
      invalidateStatusLineConfig()
      return `statusLine written. Restart bantai to re-attach the status line command (hot-swap not supported).`
    }
    case "statusBar": {
      if (typeof value !== "string") return null
      if (value === getCurrentStatusBarId()) return null
      const preset = getStatusBar(value)
      const applied = applyStatusBar(value)
      if (applied.fellBack) {
        return `Unknown status bar preset "${value}" — falling back to "${applied.id}". Register the preset or correct the id.`
      }
      return `Status bar applied: ${preset?.name ?? applied.id}.`
    }
    default:
      // Most settings are only consumed at bootstrap — the persisted value
      // takes effect on the next launch. Signal that clearly so users don't
      // expect a live change.
      return `Saved. Takes effect on next launch.`
  }
}

export const settingsCommand: SlashCommand = {
  name: "settings",
  description: "View or change persistent bantai settings",
  argumentHint: "[<key>] | [set <key> <value>]",
  execute: async (args, ctx) => {
    const trimmed = args.trim()

    // /settings set <key> <value>
    if (trimmed.startsWith("set ") || trimmed === "set") {
      const rest = trimmed.slice(3).trim()
      const spaceIdx = rest.indexOf(" ")
      if (spaceIdx < 0) {
        ctx.pushEvent({
          type: "system_message",
          text: "Usage: /settings set <key> <value>",
          ephemeral: true,
        })
        return
      }
      const key = rest.slice(0, spaceIdx).trim() as keyof BantaiConfig
      const raw = rest.slice(spaceIdx + 1).trim()

      if (!DISPLAY_KEYS.includes(key)) {
        ctx.pushEvent({
          type: "system_message",
          text: `Unknown setting: ${key}\nKnown: ${DISPLAY_KEYS.join(", ")}`,
          ephemeral: true,
        })
        return
      }

      let coerced: unknown
      try {
        coerced = coerceSettingValue(key, raw)
      } catch (err) {
        ctx.pushEvent({
          type: "system_message",
          text: `Invalid value: ${err instanceof Error ? err.message : String(err)}`,
          ephemeral: true,
        })
        return
      }

      let path: string
      try {
        path = await writeGlobalSetting(key, coerced, {})
      } catch (err) {
        ctx.pushEvent({
          type: "system_message",
          text: `Failed to write settings: ${err instanceof Error ? err.message : String(err)}`,
          ephemeral: true,
        })
        return
      }

      const note = applyInMemory(key, coerced)
      const lines = [
        `Set ${key} = ${formatSettingValue(coerced)}`,
        `  written to: ${path}`,
      ]
      if (note) lines.push(`  ${note}`)
      ctx.pushEvent({ type: "system_message", text: lines.join("\n"), ephemeral: true })
      return
    }

    const resolved = await loadConfig()

    // /settings (no args) — list everything
    if (!trimmed) {
      ctx.pushEvent({ type: "system_message", text: renderList(resolved), ephemeral: true })
      return
    }

    // /settings <key>
    const key = trimmed as keyof BantaiConfig
    if (!DISPLAY_KEYS.includes(key)) {
      ctx.pushEvent({
        type: "system_message",
        text: `Unknown setting: ${key}\nKnown: ${DISPLAY_KEYS.join(", ")}`,
        ephemeral: true,
      })
      return
    }
    ctx.pushEvent({ type: "system_message", text: renderDetail(resolved, key), ephemeral: true })
  },
}
