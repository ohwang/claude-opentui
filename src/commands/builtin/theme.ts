/**
 * /theme command — list and switch themes at runtime.
 *
 * Usage:
 *   /theme           — list available themes with current marked
 *   /theme <id>      — switch to a theme preset
 *   /theme list      — same as /theme
 *
 * Frontend-neutral: delegates listing/applying to `ctx.frontend`. Non-TUI
 * frontends that don't implement theming surface an explanatory message.
 */

import type { SlashCommand } from "../registry"

export const themeCommand: SlashCommand = {
  name: "theme",
  description: "List or switch themes",
  argumentHint: "[theme-id]",
  execute: (args, ctx) => {
    const themeId = args.trim()
    const { frontend } = ctx

    if (!frontend?.listThemes || !frontend?.applyTheme) {
      ctx.pushEvent({
        type: "system_message",
        text: "Theme switching is not supported by this frontend.",
        ephemeral: true,
      })
      return
    }

    // No args or "list" — show available themes
    if (!themeId || themeId === "list") {
      const themes = frontend.listThemes()
      const currentId = frontend.currentThemeId?.()

      const lines = [
        "Available themes:",
        "",
        ...themes.map((t) => {
          const marker = t.id === currentId ? " (active)" : ""
          return `  ${t.id} — ${t.name}${marker}`
        }),
        "",
        "Switch: /theme <id>",
      ]

      ctx.pushEvent({ type: "system_message", text: lines.join("\n") })
      return
    }

    // Try to switch theme
    const currentId = frontend.currentThemeId?.()
    if (themeId === currentId) {
      // Short-circuit: bridge would also detect this, but we avoid the redundant work.
      const match = frontend.listThemes().find((t) => t.id === themeId)
      ctx.pushEvent({
        type: "system_message",
        text: `Already using theme: ${match?.name ?? themeId}`,
      })
      return
    }

    const result = frontend.applyTheme(themeId)
    if (!result.ok) {
      ctx.pushEvent({
        type: "system_message",
        text: result.error ?? `Failed to apply theme "${themeId}".`,
      })
      return
    }

    ctx.pushEvent({
      type: "system_message",
      text: `Switched to ${result.appliedName ?? themeId}. New content will use the updated theme.`,
    })
  },
}
