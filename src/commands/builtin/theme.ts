/**
 * /theme command — list available themes and show current theme.
 *
 * Theme switching at runtime is not yet supported; themes are selected
 * at startup via --theme <id>. This command shows available presets
 * and which one is active.
 */

import type { SlashCommand } from "../registry"
import { listThemes } from "../../tui/theme/registry"
import { getCurrentThemeId } from "../../tui/theme/tokens"

export const themeCommand: SlashCommand = {
  name: "theme",
  description: "List available themes",
  execute: (_args, ctx) => {
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
      "Switch themes with: --theme <id> (restart required)",
    ]

    ctx.pushEvent({
      type: "system_message",
      text: lines.join("\n"),
    })
  },
}
