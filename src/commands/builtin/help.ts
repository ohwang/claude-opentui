/**
 * /help — Show available commands organized by type.
 *
 * Groups commands into Local (run in TUI) and Prompt (send to model)
 * sections with aliases and argument hints.
 */

import type { SlashCommand, CommandContext } from "../registry"

export const helpCommand: SlashCommand = {
  name: "help",
  description: "Show available commands and shortcuts",
  aliases: ["h", "?"],
  execute: (_args: string, ctx: CommandContext) => {
    const commands = ctx.registry?.all() ?? []

    // Group by type
    const local = commands.filter(c => c.type !== "prompt")
    const prompts = commands.filter(c => c.type === "prompt")

    const formatCmd = (cmd: SlashCommand): string => {
      const alias = cmd.aliases?.length ? ` (${cmd.aliases.join(", ")})` : ""
      const hint = cmd.argumentHint ? ` ${cmd.argumentHint}` : ""
      return `  /${cmd.name}${hint}${alias} — ${cmd.description}`
    }

    const lines: string[] = [
      "Commands",
      "",
      ...local.map(formatCmd),
    ]

    if (prompts.length > 0) {
      lines.push("", "Prompt shortcuts (send to model)", "")
      lines.push(...prompts.map(formatCmd))
    }

    lines.push(
      "",
      "Shortcuts",
      "",
      "  Ctrl+O     Toggle tool detail view",
      "  Ctrl+E     Toggle show-all view",
      "  Ctrl+T     Toggle thinking blocks",
      "  Ctrl+P     Cycle model forward",
      "  Ctrl+Up    Scroll up",
      "  Ctrl+Down  Scroll down",
      "  Ctrl+L     Clear conversation",
      "  Ctrl+G     Open external editor",
      "  Ctrl+V     Paste (text or image)",
      "  Ctrl+C     Interrupt / clear input",
      "  Ctrl+D×2   Exit",
      "  Shift+Tab  Cycle permission mode",
      "  Up/Down    Input history",
      "  @file      File autocomplete",
    )

    ctx.pushEvent({
      type: "system_message",
      text: lines.join("\n"),
      ephemeral: true,
    })
  },
}
