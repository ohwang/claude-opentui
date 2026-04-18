/**
 * /help — open the help panel.
 *
 * Frontend-neutral: emits a `help` panel request via the FrontendBridge.
 * The TUI frontend renders a modal; other frontends (Slack, GUI) can
 * render this however they like.
 */

import type { SlashCommand, CommandContext } from "../registry"
import type { HelpPanelData } from "../frontend"

export const helpCommand: SlashCommand = {
  name: "help",
  description: "Show available commands and shortcuts",
  aliases: ["h", "?"],
  execute: (_args: string, ctx: CommandContext) => {
    const data: HelpPanelData = {
      commands: (ctx.registry?.all() ?? []).map((cmd) => ({
        name: cmd.name,
        description: cmd.description,
        aliases: cmd.aliases,
        argumentHint: cmd.argumentHint,
        type: cmd.type,
      })),
    }

    if (ctx.frontend?.openPanel) {
      ctx.frontend.openPanel("help", data)
      return
    }

    // Fallback: frontend has no panel UI — dump a plain text summary.
    const lines = [
      "Commands:",
      ...data.commands.map((c) => {
        const alias = c.aliases?.length ? ` (${c.aliases.join(", ")})` : ""
        const hint = c.argumentHint ? ` ${c.argumentHint}` : ""
        return `  /${c.name}${hint}${alias} — ${c.description}`
      }),
    ]
    ctx.pushEvent({ type: "system_message", text: lines.join("\n") })
  },
}
