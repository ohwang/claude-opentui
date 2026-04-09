/**
 * Community Theme Loader
 *
 * Loads user-defined theme JSON files from ~/.claude-opentui/themes/
 * at startup and registers them in the theme registry.
 *
 * Theme files must be valid JSON conforming to ThemeDefinition:
 *   { "id": "my-theme", "name": "My Theme", "colors": { ... } }
 *
 * Invalid files are silently skipped with a warning log.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { registerTheme } from "./registry"
import type { ThemeDefinition, ThemeColors } from "./types"
import { log } from "../../utils/logger"

const THEMES_DIR = join(homedir(), ".claude-opentui", "themes")

/** Required top-level categories in ThemeColors */
const REQUIRED_CATEGORIES: (keyof ThemeColors)[] = [
  "text", "bg", "accent", "status", "border",
  "state", "permission", "diff", "rateLimit", "agents",
]

/** Basic validation — checks structure, not color values */
function isValidTheme(obj: unknown): obj is ThemeDefinition {
  if (!obj || typeof obj !== "object") return false
  const t = obj as Record<string, unknown>
  if (typeof t.id !== "string" || !t.id) return false
  if (typeof t.name !== "string" || !t.name) return false
  if (!t.colors || typeof t.colors !== "object") return false

  const colors = t.colors as Record<string, unknown>
  for (const cat of REQUIRED_CATEGORIES) {
    if (!colors[cat] || typeof colors[cat] !== "object") return false
  }

  return true
}

/**
 * Load all .json theme files from ~/.claude-opentui/themes/
 * and register them in the theme registry.
 *
 * Call this early in startup, before theme selection.
 */
export function loadCommunityThemes(): number {
  if (!existsSync(THEMES_DIR)) return 0

  let loaded = 0
  let files: string[]
  try {
    files = readdirSync(THEMES_DIR).filter(f => f.endsWith(".json"))
  } catch {
    return 0
  }

  for (const file of files) {
    const filePath = join(THEMES_DIR, file)
    try {
      const raw = readFileSync(filePath, "utf-8")
      const parsed = JSON.parse(raw)

      if (!isValidTheme(parsed)) {
        log.warn("Invalid theme file — skipping", { file, reason: "missing required fields" })
        continue
      }

      registerTheme(parsed)
      loaded++
      log.debug("Loaded community theme", { id: parsed.id, name: parsed.name, file })
    } catch (err) {
      log.warn("Failed to parse theme file", { file, error: String(err) })
    }
  }

  return loaded
}
