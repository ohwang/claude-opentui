/**
 * /theme command — list and switch themes at runtime.
 *
 * Usage:
 *   /theme           — list available themes with current marked
 *   /theme <id>      — switch to a theme preset
 *   /theme list      — same as /theme
 */

import type { SlashCommand } from "../registry"
import { listThemes, getTheme } from "../../tui/theme/registry"
import { applyTheme, getCurrentThemeId } from "../../tui/theme/tokens"

export const themeCommand: SlashCommand = {
  name: "theme",
  description: "List or switch themes",
  argumentHint: "[theme-id]",
  execute: (args, ctx) => {
    const themeId = args.trim()

    // No args or "list" — show available themes
    if (!themeId || themeId === "list") {
      const themes = listThemes()
      const currentId = getCurrentThemeId()

      const lines = [
        "Available themes:",
        "",
        ...themes.map(t => {
          const marker = t.id === currentId ? " (active)" : ""
          return `  ${t.id} — ${t.name}${marker}`
        }),
        "",
        "Switch: /theme <id>",
      ]

      ctx.pushEvent({
        type: "system_message",
        text: lines.join("\n"),
      })
      return
    }

    // Try to switch theme
    const theme = getTheme(themeId)
    if (!theme) {
      const available = listThemes().map(t => t.id).join(", ")
      ctx.pushEvent({
        type: "system_message",
        text: `Unknown theme: "${themeId}". Available: ${available}`,
      })
      return
    }

    const currentId = getCurrentThemeId()
    if (themeId === currentId) {
      ctx.pushEvent({
        type: "system_message",
        text: `Already using theme: ${theme.name}`,
      })
      return
    }

    // Apply the theme (mutates colors in-place, rebuilds syntax style)
    applyTheme(theme)

    ctx.pushEvent({
      type: "system_message",
      text: `Switched to ${theme.name}. New content will use the updated theme.`,
    })
  },
}
