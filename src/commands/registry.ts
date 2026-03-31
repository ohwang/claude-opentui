/**
 * Slash Command Registry
 *
 * Manages slash commands. Components check for '/' at position 0
 * and dispatch through this registry.
 *
 * Supports fuzzy matching for command palette UX.
 */

import type { AgentBackend, Block, CostTotals, SessionConfig, SessionMetadata } from "../protocol/types"

export interface CommandContext {
  backend: AgentBackend
  pushEvent: (event: any) => void
  clearConversation: () => void
  resetCost: () => void
  setModel: (model: string) => Promise<void>
  exit?: () => void
  toggleDiagnostics?: () => void
  getSessionState?: () => { cost: CostTotals; turnNumber: number; currentModel: string; session: SessionMetadata | null }
  getBlocks?: () => Block[]
  registry?: CommandRegistry
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

    // Inject registry reference so commands like /help can enumerate all commands
    if (!ctx.registry) ctx.registry = this
    await command.execute(args, ctx)
    return true
  }
}

import { copyCommand } from "./builtin/copy"
import { helpCommand } from "./builtin/help"
import { clearCommand } from "./builtin/clear"
import { newCommand } from "./builtin/new"
import { compactCommand } from "./builtin/compact"
import { modelCommand } from "./builtin/model"
import { costCommand } from "./builtin/cost"
import { usageCommand } from "./builtin/usage"
import { hotkeysCommand } from "./builtin/hotkeys"
import { diagnosticsCommand } from "./builtin/diagnostics"
import { exitCommand } from "./builtin/exit"

/** Create a registry with all built-in commands */
export function createCommandRegistry(): CommandRegistry {
  const registry = new CommandRegistry()

  registry.register(copyCommand)
  registry.register(helpCommand)
  registry.register(clearCommand)
  registry.register(newCommand)
  registry.register(compactCommand)
  registry.register(modelCommand)
  registry.register(costCommand)
  registry.register(usageCommand)
  registry.register(hotkeysCommand)
  registry.register(diagnosticsCommand)
  registry.register(exitCommand)

  return registry
}
