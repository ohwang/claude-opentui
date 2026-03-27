/**
 * Slash Command Registry
 *
 * Manages slash commands. Components check for '/' at position 0
 * and dispatch through this registry.
 *
 * Supports fuzzy matching for command palette UX.
 */

import type { AgentBackend, SessionConfig } from "../protocol/types"

export interface CommandContext {
  backend: AgentBackend
  pushEvent: (event: any) => void
  clearMessages: () => void
  setModel: (model: string) => Promise<void>
}

export interface SlashCommand {
  name: string
  description: string
  aliases?: string[]
  execute: (args: string, ctx: CommandContext) => void | Promise<void>
}

export class CommandRegistry {
  private commands = new Map<string, SlashCommand>()

  register(command: SlashCommand): void {
    this.commands.set(command.name, command)
    if (command.aliases) {
      for (const alias of command.aliases) {
        this.commands.set(alias, command)
      }
    }
  }

  get(name: string): SlashCommand | undefined {
    return this.commands.get(name)
  }

  all(): SlashCommand[] {
    // Deduplicate (aliases point to same command)
    const seen = new Set<SlashCommand>()
    const result: SlashCommand[] = []
    for (const cmd of this.commands.values()) {
      if (!seen.has(cmd)) {
        seen.add(cmd)
        result.push(cmd)
      }
    }
    return result
  }

  /** Fuzzy match command names against a query */
  search(query: string): SlashCommand[] {
    const q = query.toLowerCase()
    return this.all()
      .filter(
        (cmd) =>
          cmd.name.toLowerCase().includes(q) ||
          cmd.description.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        // Exact prefix match first
        const aPrefix = a.name.toLowerCase().startsWith(q) ? 0 : 1
        const bPrefix = b.name.toLowerCase().startsWith(q) ? 0 : 1
        return aPrefix - bPrefix || a.name.localeCompare(b.name)
      })
  }

  /** Parse input and execute if it starts with '/' */
  async tryExecute(
    input: string,
    ctx: CommandContext,
  ): Promise<boolean> {
    if (!input.startsWith("/")) return false

    const parts = input.slice(1).split(/\s+/)
    const name = parts[0]
    const args = parts.slice(1).join(" ")

    const command = this.get(name)
    if (!command) return false

    await command.execute(args, ctx)
    return true
  }
}

/** Create a registry with all built-in commands */
export function createCommandRegistry(): CommandRegistry {
  const registry = new CommandRegistry()

  // /help
  registry.register({
    name: "help",
    description: "Show available commands",
    aliases: ["?"],
    execute: (_args, ctx) => {
      const commands = registry.all()
      const text = commands
        .map((cmd) => `  /${cmd.name} — ${cmd.description}`)
        .join("\n")

      ctx.pushEvent({
        type: "system_message",
        text: `Available commands:\n${text}`,
      })
    },
  })

  // /clear
  registry.register({
    name: "clear",
    description: "Clear the conversation display",
    execute: (_args, ctx) => {
      ctx.clearMessages()
    },
  })

  // /compact
  registry.register({
    name: "compact",
    description: "Compact conversation context",
    execute: (_args, ctx) => {
      ctx.pushEvent({
        type: "compact",
        summary: "Conversation compacted by user request.",
      })
    },
  })

  // /model
  registry.register({
    name: "model",
    description: "Switch model (e.g., /model claude-sonnet-4-6)",
    aliases: ["m"],
    execute: async (args, ctx) => {
      if (!args.trim()) {
        ctx.pushEvent({
          type: "system_message",
          text: "Usage: /model <model-name>",
        })
        return
      }
      await ctx.setModel(args.trim())
      ctx.pushEvent({
        type: "system_message",
        text: `Switched to ${args.trim()}`,
      })
    },
  })

  // /cost
  registry.register({
    name: "cost",
    description: "Show current session cost and token usage",
    execute: async (_args, ctx) => {
      const models = await ctx.backend.availableModels()
      const caps = ctx.backend.capabilities()
      const modelList = models.map((m) => m.name || m.id).join(", ")
      ctx.pushEvent({
        type: "system_message",
        text: `Backend: ${caps.name}\nModels: ${modelList || "unknown"}\nUse the status bar for live cost/token tracking.`,
      })
    },
  })

  // /exit
  registry.register({
    name: "exit",
    description: "Exit the application",
    aliases: ["quit", "q"],
    execute: () => {
      process.exit(0)
    },
  })

  return registry
}
