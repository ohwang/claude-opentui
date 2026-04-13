/**
 * /config — View and change backend config options.
 *
 * Usage:
 *   /config              — list all available config options
 *   /config <id>         — show details for a specific option
 *   /config set <id> <value> — change a config option
 */

import type { SlashCommand } from "../registry"
import type { ConfigOption } from "../../protocol/types"

export const configCommand: SlashCommand = {
  name: "config",
  description: "View or change agent config options",
  argumentHint: "[set <id> <value>]",
  execute: async (args, ctx) => {
    const state = ctx.getSessionState?.()
    const options: ConfigOption[] = (state as any)?.configOptions ?? []

    if (!args.trim()) {
      // List all config options
      if (options.length === 0) {
        ctx.pushEvent({
          type: "system_message",
          text: "No config options available from this backend.",
          ephemeral: true,
        })
        return
      }

      const lines = ["Agent Config Options", ""]
      for (const opt of options) {
        const valueStr = formatValue(opt)
        const typeHint = opt.type === "enum" && opt.choices
          ? ` (${opt.choices.map(c => c.id).join("|")})`
          : opt.type === "boolean" ? " (true|false)" : ""
        lines.push(`  ${opt.id}: ${valueStr}${typeHint}`)
        if (opt.description) {
          lines.push(`    ${opt.description}`)
        }
      }
      lines.push("")
      lines.push("Use /config set <id> <value> to change an option")

      ctx.pushEvent({
        type: "system_message",
        text: lines.join("\n"),
        ephemeral: true,
      })
      return
    }

    const parts = args.trim().split(/\s+/)

    // /config set <id> <value>
    if (parts[0] === "set" && parts.length >= 3) {
      const id = parts[1]!
      const value = parts.slice(2).join(" ")
      const option = options.find(o => o.id === id)

      if (!option) {
        ctx.pushEvent({
          type: "system_message",
          text: `Unknown config option: ${id}\n\nAvailable: ${options.map(o => o.id).join(", ") || "none"}`,
          ephemeral: true,
        })
        return
      }

      // Coerce value to the expected type
      let coerced: unknown = value
      if (option.type === "boolean") {
        coerced = value === "true" || value === "1" || value === "yes"
      } else if (option.type === "enum") {
        // Validate against choices
        const valid = option.choices?.find(c => c.id === value || c.name.toLowerCase() === value.toLowerCase())
        if (!valid) {
          const validChoices = option.choices?.map(c => c.id).join(", ") ?? "none"
          ctx.pushEvent({
            type: "system_message",
            text: `Invalid value for ${id}: ${value}\n\nValid choices: ${validChoices}`,
            ephemeral: true,
          })
          return
        }
        coerced = valid.id
      }

      try {
        await ctx.backend.setConfigOption?.(id, coerced)
        ctx.pushEvent({
          type: "system_message",
          text: `Config option ${id} set to ${String(coerced)}`,
          ephemeral: true,
        })
      } catch (err) {
        ctx.pushEvent({
          type: "system_message",
          text: `Failed to set ${id}: ${err}`,
          ephemeral: true,
        })
      }
      return
    }

    // /config <id> — show details for a specific option
    const id = parts[0]!
    const option = options.find(o => o.id === id)
    if (option) {
      const lines = [
        `Config: ${option.id}`,
        `  Name: ${option.name}`,
        `  Type: ${option.type}`,
        `  Value: ${formatValue(option)}`,
      ]
      if (option.description) lines.push(`  Description: ${option.description}`)
      if (option.choices) {
        lines.push(`  Choices:`)
        for (const c of option.choices) {
          const selected = c.id === String(option.value) ? " <- current" : ""
          lines.push(`    ${c.id}: ${c.name}${selected}`)
        }
      }
      ctx.pushEvent({ type: "system_message", text: lines.join("\n"), ephemeral: true })
    } else {
      ctx.pushEvent({
        type: "system_message",
        text: `Unknown config option: ${id}\n\nAvailable: ${options.map(o => o.id).join(", ") || "none"}`,
        ephemeral: true,
      })
    }
  },
}

function formatValue(opt: ConfigOption): string {
  if (opt.value == null) return "(not set)"
  if (opt.type === "enum" && opt.choices) {
    const choice = opt.choices.find(c => c.id === String(opt.value))
    return choice ? `${choice.name} (${choice.id})` : String(opt.value)
  }
  return String(opt.value)
}
