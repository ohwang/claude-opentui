/**
 * Slash Command Registry
 *
 * Manages slash commands. Components check for '/' at position 0
 * and dispatch through this registry.
 *
 * Supports prefix/substring matching for autocomplete.
 */

import type { CliRenderer } from "@opentui/core"
import type { AgentBackend, Block, ConfigOption, CostTotals, SessionMetadata } from "../protocol/types"

export interface CommandContext {
  backend: AgentBackend
  pushEvent: (event: any) => void
  clearConversation: () => void
  resetCost: () => void
  /** Reset the backend session (create a fresh server-side session). */
  resetSession: () => Promise<void>
  setModel: (model: string) => Promise<void>
  exit?: () => void
  toggleDiagnostics?: () => void
  getSessionState?: () => { cost: CostTotals; turnNumber: number; currentModel: string; currentEffort: string; session: SessionMetadata | null; configOptions?: ConfigOption[] }
  getBlocks?: () => Block[]
  registry?: CommandRegistry
  renderer?: CliRenderer
}

export interface SlashCommand {
  name: string
  description: string
  aliases?: string[]
  /** 'local' runs in TUI (default), 'prompt' sends text to the model as a user message */
  type?: "local" | "prompt"
  /** Hint text shown after the command name in autocomplete (e.g., "<file path>") */
  argumentHint?: string
  execute: (args: string, ctx: CommandContext) => void | Promise<void>
}

/** Create a prompt command — sends a fixed prompt (optionally with user args) to the model */
export function createPromptCommand(opts: {
  name: string
  description: string
  aliases?: string[]
  prompt: string | ((args: string) => string)
  argumentHint?: string
}): SlashCommand {
  return {
    name: opts.name,
    description: opts.description,
    aliases: opts.aliases,
    type: "prompt",
    argumentHint: opts.argumentHint,
    execute: (args, ctx) => {
      const text = typeof opts.prompt === "function" ? opts.prompt(args) : (args ? `${opts.prompt} ${args}` : opts.prompt)
      ctx.pushEvent({ type: "user_message", text })
      ctx.backend.sendMessage({ text })
    },
  }
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

  /** Match command names (and aliases) against a query using prefix/substring matching */
  search(query: string): SlashCommand[] {
    const q = query.toLowerCase()
    return this.all()
      .filter(
        (cmd) =>
          cmd.name.toLowerCase().includes(q) ||
          (cmd.aliases?.some((alias) => alias.toLowerCase().includes(q)) ?? false),
      )
      .sort((a, b) => {
        // Exact prefix match on name first, then alias prefix, then substring
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
    const name = parts[0] ?? ""
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
import { bugCommand, reviewCommand, commitCommand, testCommand } from "./builtin/prompts"
import { aboutCommand } from "./builtin/about"
import { screenshotCommand } from "./builtin/screenshot"
import { thinkingCommand } from "./builtin/thinking"
import { themeCommand } from "./builtin/theme"
import { configCommand } from "./builtin/config"
import { settingsCommand } from "./builtin/settings"
import { crossagentCommand } from "../subagents/commands"

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

  // Prompt commands — send prompts to the model
  registry.register(bugCommand)
  registry.register(reviewCommand)
  registry.register(commitCommand)
  registry.register(testCommand)
  registry.register(aboutCommand)
  registry.register(screenshotCommand)
  registry.register(thinkingCommand)
  registry.register(themeCommand)
  registry.register(configCommand)
  registry.register(settingsCommand)
  registry.register(crossagentCommand)

  return registry
}
