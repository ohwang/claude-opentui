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

/** Format token counts for human-readable display */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

import { copyCommand } from "./builtin/copy"

/** Create a registry with all built-in commands */
export function createCommandRegistry(): CommandRegistry {
  const registry = new CommandRegistry()

  // /copy
  registry.register(copyCommand)

  // /help
  registry.register({
    name: "help",
    description: "Show available commands",
    aliases: ["?"],
    execute: (_args, ctx) => {
      const commands = registry.all()
      const text = commands
        .map((cmd) => {
          const aliasText =
            cmd.aliases && cmd.aliases.length > 0
              ? ` (aliases: ${cmd.aliases.join(", ")})`
              : ""
          return `  /${cmd.name}${aliasText} — ${cmd.description}`
        })
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
      ctx.clearConversation()
    },
  })

  // /new — start a fresh conversation (clear + reset cost)
  registry.register({
    name: "new",
    aliases: ["n"],
    description: "Start a fresh conversation",
    execute: (_args, ctx) => {
      ctx.clearConversation()
      ctx.resetCost()
      ctx.pushEvent({
        type: "system_message",
        text: "New conversation started",
      })
    },
  })

  // /compact — triggers real backend compaction via the SDK's built-in /compact handler
  registry.register({
    name: "compact",
    description: "Compact conversation context",
    execute: (args, ctx) => {
      // Build the /compact message with optional custom instructions
      const compactText = args.trim()
        ? `/compact ${args.trim()}`
        : "/compact"

      // Send as a user message — the SDK's CLI subprocess recognizes /compact
      // and triggers real context compaction (summarization, token reduction).
      // The SDK will emit status: 'compacting' and compact_boundary messages
      // which the adapter already maps to AgentEvents.
      ctx.backend.sendMessage({ text: compactText })

      // Immediate UI feedback while the backend compacts
      ctx.pushEvent({
        type: "system_message",
        text: "Compacting conversation...",
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
      const modelName = args.trim()
      try {
        await ctx.setModel(modelName)
        ctx.pushEvent({
          type: "model_changed",
          model: modelName,
        })
        ctx.pushEvent({
          type: "system_message",
          text: `Switched to ${modelName}`,
        })
      } catch (error) {
        ctx.pushEvent({
          type: "system_message",
          text: `Error: Could not switch to model '${modelName}'. ${error instanceof Error ? error.message : 'Unknown error'}`,
        })
      }
    },
  })

  // /cost — detailed cost and token breakdown
  registry.register({
    name: "cost",
    description: "Show session cost and token breakdown",
    execute: (_args, ctx) => {
      const state = ctx.getSessionState?.()
      if (!state) {
        ctx.pushEvent({ type: "system_message", text: "Cost data not available." })
        return
      }

      const { cost, turnNumber, currentModel } = state
      const totalTokens = cost.inputTokens + cost.outputTokens
      const cacheTokens = cost.cacheReadTokens + cost.cacheWriteTokens

      const lines = [
        `Session Usage (${turnNumber} turn${turnNumber !== 1 ? "s" : ""})`,
        ``,
        `  Model:    ${currentModel || "unknown"}`,
        `  Cost:     $${cost.totalCostUsd.toFixed(4)}`,
        ``,
        `  Tokens:   ${formatTokens(totalTokens)} total`,
        `    Input:  ${formatTokens(cost.inputTokens)}`,
        `    Output: ${formatTokens(cost.outputTokens)}`,
        `    Cache:  ${formatTokens(cacheTokens)} (${formatTokens(cost.cacheReadTokens)} read, ${formatTokens(cost.cacheWriteTokens)} write)`,
      ]

      if (turnNumber > 0) {
        lines.push(``)
        lines.push(`  Avg/turn: $${(cost.totalCostUsd / turnNumber).toFixed(4)} · ${formatTokens(Math.round(totalTokens / turnNumber))} tokens`)
      }

      ctx.pushEvent({ type: "system_message", text: lines.join("\n") })
    },
  })

  // /usage — plan-level usage info
  registry.register({
    name: "usage",
    description: "Show plan usage and account info",
    execute: (_args, ctx) => {
      const state = ctx.getSessionState?.()
      if (!state) {
        ctx.pushEvent({ type: "system_message", text: "Usage data not available." })
        return
      }

      const { session, cost, turnNumber } = state
      const account = session?.account

      if (!account?.plan) {
        const lines = [
          "Plan usage info not available. Use /cost for session costs.",
        ]
        ctx.pushEvent({ type: "system_message", text: lines.join("\n") })
        return
      }

      const lines = [
        `Plan Usage`,
        ``,
        `  Plan:     ${account.plan}`,
      ]

      if (account.email) {
        lines.push(`  Account:  ${account.email}`)
      }

      lines.push(``)
      lines.push(`  Session cost: $${cost.totalCostUsd.toFixed(4)} (${turnNumber} turn${turnNumber !== 1 ? "s" : ""})`)

      ctx.pushEvent({ type: "system_message", text: lines.join("\n") })
    },
  })

  // /hotkeys
  registry.register({
    name: "hotkeys",
    description: "Show all keyboard shortcuts",
    aliases: ["keys", "shortcuts"],
    execute: (_args, ctx) => {
      const sections: Array<{ title: string; keys: Array<[string, string]> }> = [
        {
          title: "General",
          keys: [
            ["Ctrl+L",         "Clear conversation display"],
            ["Ctrl+D ×2",      "Exit application (double-press)"],
            ["Ctrl+C",         "Interrupt task / clear input / exit (double-press when idle)"],
            ["Ctrl+P",         "Cycle to next model"],
            ["Shift+Ctrl+P",   "Cycle to previous model"],
            ["Ctrl+Shift+D",   "Toggle diagnostics panel (or use /diagnostics)"],
            ["Shift+Tab",      "Cycle permission mode (default → acceptEdits → yolo → plan)"],
          ],
        },
        {
          title: "Input",
          keys: [
            ["Return",         "Submit message"],
            ["Shift+Return",   "Insert newline"],
            ["Meta+Return",    "Insert newline"],
            ["Ctrl+A",         "Select all text"],
            ["Ctrl+G",         "Open external editor ($EDITOR)"],
            ["Up / Down",      "Browse input history"],
            ["Escape",         "Dismiss autocomplete / clear input"],
            ["Tab",            "Cycle slash command completions"],
          ],
        },
        {
          title: "Conversation View",
          keys: [
            ["Ctrl+O",         "Toggle collapsed / expanded tool view"],
            ["Ctrl+E",         "Toggle show-all / collapsed view"],
            ["Ctrl+T",         "Toggle thinking blocks"],
            ["Ctrl+Up",        "Scroll up"],
            ["Ctrl+Down",      "Scroll down"],
          ],
        },
        {
          title: "Permission Dialog",
          keys: [
            ["y  or  1",       "Allow (once)"],
            ["a  or  2",       "Always allow"],
            ["n  or  3",       "Deny"],
            ["d  or  4",       "Deny for session"],
            ["Escape",         "Deny"],
            ["Up / Down / Tab","Navigate options"],
            ["Return",         "Confirm selected option"],
          ],
        },
      ]

      // Build formatted output
      const nameWidth = 18
      const lines: string[] = ["Keyboard Shortcuts", ""]

      for (const section of sections) {
        lines.push(`  ${section.title}`)
        lines.push(`  ${"—".repeat(48)}`)
        for (const [key, desc] of section.keys) {
          lines.push(`  ${key.padEnd(nameWidth)} ${desc}`)
        }
        lines.push("")
      }

      ctx.pushEvent({ type: "system_message", text: lines.join("\n") })
    },
  })

  // /diagnostics
  registry.register({
    name: "diagnostics",
    description: "Toggle the diagnostics panel",
    aliases: ["diag", "debug"],
    execute: (_args, ctx) => {
      if (ctx.toggleDiagnostics) {
        ctx.toggleDiagnostics()
      } else {
        ctx.pushEvent({
          type: "system_message",
          text: "Diagnostics panel not available.",
        })
      }
    },
  })

  // /exit
  registry.register({
    name: "exit",
    description: "Exit the application",
    aliases: ["quit", "q"],
    execute: (_args, ctx) => {
      if (ctx.exit) {
        ctx.exit()
      } else {
        ctx.backend.close()
        process.exit(0)
      }
    },
  })

  return registry
}
