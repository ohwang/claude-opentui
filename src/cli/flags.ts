/**
 * CLI Flag Parsing
 *
 * Parses command-line arguments into a typed config.
 * Supports core Claude Code flags for drop-in compatibility.
 *
 * See research/cli-params.md for the full flag classification.
 */

import type { SessionConfig, PermissionMode } from "../protocol/types"

export interface CLIFlags {
  /** Session config derived from flags */
  config: SessionConfig

  /** Initial prompt (positional arg or --prompt) */
  prompt?: string

  /** Backend selection */
  backend: string

  /** Print help and exit */
  help: boolean

  /** Print version and exit */
  version: boolean

  /** Enable debug output */
  debug: boolean

  /** Enable raw backend JSONL tracing */
  debugBackend: boolean

  /** Disable the MCP diagnostics server */
  noDiagnosticsMcp: boolean

  /** Theme preset ID */
  theme?: string

  /** ACP command (for --backend acp) */
  acpCommand?: string

  /** ACP args (for --backend acp) */
  acpArgs?: string[]
}

/**
 * Validate that a flag's required value argument is present and not another flag.
 *
 * NOTE: Uses console.error intentionally — flag parsing runs before the logger
 * is initialized, and the user needs to see the error on stderr before exit.
 */
function requireArg(flag: string, args: string[], i: number): string {
  const value = args[i]
  if (value === undefined || value.startsWith("-")) {
    console.error(`Error: ${flag} requires a value`)
    process.exit(1)
  }
  return value
}

export function parseFlags(argv: string[]): CLIFlags {
  const args = argv.slice(2) // Skip bun and script path

  const flags: CLIFlags = {
    config: {},
    backend: "claude",
    help: false,
    version: false,
    debug: false,
    debugBackend: false,
    noDiagnosticsMcp: false,
  }

  let i = 0
  while (i < args.length) {
    const arg = args[i]!

    switch (arg) {
      case "--help":
      case "-h":
        flags.help = true
        break

      case "--version":
      case "-v":
        flags.version = true
        break

      case "--debug":
        flags.debug = true
        break

      case "--debug-backend":
        flags.debugBackend = true
        break

      // Session management
      case "--continue":
      case "-c":
        flags.config.continue = true
        break

      case "--resume":
      case "-r":
        flags.config.resume = requireArg("--resume", args, ++i)
        break

      // Model & execution
      case "--model":
      case "-m":
        flags.config.model = requireArg("--model", args, ++i)
        break

      case "--permission-mode":
        flags.config.permissionMode = requireArg("--permission-mode", args, ++i) as PermissionMode
        break

      case "--dangerously-skip-permissions":
        flags.config.permissionMode = "bypassPermissions"
        break

      // Limits
      case "--max-turns": {
        const val = parseInt(requireArg("--max-turns", args, ++i), 10)
        if (isNaN(val) || val <= 0) {
          console.error("Error: --max-turns must be a positive integer")
          process.exit(1)
        }
        flags.config.maxTurns = val
        break
      }

      case "--max-budget": {
        const val = parseFloat(requireArg("--max-budget", args, ++i))
        if (isNaN(val) || val <= 0) {
          console.error("Error: --max-budget must be a positive number")
          process.exit(1)
        }
        flags.config.maxBudgetUsd = val
        break
      }

      // Session persistence
      case "--no-session-persistence":
        flags.config.persistSession = false
        break

      // Working directory
      case "--cwd":
        flags.config.cwd = requireArg("--cwd", args, ++i)
        break

      // Thinking & effort
      case "--thinking": {
        const val = requireArg("--thinking", args, ++i)
        if (val === "adaptive") {
          flags.config.thinking = { type: "adaptive" }
        } else if (val === "enabled") {
          flags.config.thinking = { type: "enabled" }
        } else if (val === "disabled") {
          flags.config.thinking = { type: "disabled" }
        } else {
          console.error("Error: --thinking must be adaptive, enabled, or disabled")
          process.exit(1)
        }
        break
      }

      case "--max-thinking-tokens": {
        const val = parseInt(requireArg("--max-thinking-tokens", args, ++i), 10)
        if (isNaN(val) || val <= 0) {
          console.error("Error: --max-thinking-tokens must be a positive integer")
          process.exit(1)
        }
        flags.config.thinking = { type: "enabled", budgetTokens: val }
        break
      }

      case "--effort": {
        const val = requireArg("--effort", args, ++i)
        if (val === "low" || val === "medium" || val === "high" || val === "max") {
          flags.config.effort = val
        } else {
          console.error("Error: --effort must be low, medium, high, or max")
          process.exit(1)
        }
        break
      }

      // System prompt
      case "--system-prompt":
        flags.config.systemPrompt = requireArg("--system-prompt", args, ++i)
        break

      // Backend selection
      case "--backend":
      case "-b":
        flags.backend = requireArg("--backend", args, ++i)
        break

      case "--no-diagnostics-mcp":
        flags.noDiagnosticsMcp = true
        break

      // ACP options
      case "--acp-command":
        flags.acpCommand = requireArg("--acp-command", args, ++i)
        break

      case "--acp-args":
        if (!flags.acpArgs) flags.acpArgs = []
        flags.acpArgs.push(requireArg("--acp-args", args, ++i))
        break

      case "--theme":
        flags.theme = requireArg("--theme", args, ++i)
        break

      // Prompt
      case "--prompt":
      case "-p":
        flags.prompt = requireArg("--prompt", args, ++i)
        break

      default:
        // Positional argument = prompt
        if (!arg.startsWith("-") && !flags.prompt) {
          flags.prompt = arg
        }
        break
    }
    i++
  }

  return flags
}

export function printHelp(): void {
  console.log(`
claude-opentui — Open-source Claude Code TUI

Usage: claude-opentui [options] [prompt]

Options:
  -h, --help              Show this help
  -v, --version           Show version
  -m, --model <model>     Set the model
  -p, --prompt <text>     Initial prompt
  -c, --continue          Continue most recent session
  -r, --resume <id>       Resume a specific session
  -b, --backend <name>    Backend (claude, codex, gemini, gemini-acp, copilot-acp, acp, mock)
  --permission-mode <m>   Permission mode (default, acceptEdits, bypassPermissions, plan, dontAsk)
  --dangerously-skip-permissions  Shorthand for --permission-mode bypassPermissions
  --max-turns <n>         Maximum turns
  --max-budget <usd>      Maximum budget in USD
  --no-session-persistence  Disable session persistence to disk
  --cwd <path>            Working directory
  --thinking <mode>       Thinking mode (adaptive, enabled, disabled)
  --max-thinking-tokens <n>  Fixed thinking token budget (sets thinking to enabled)
  --effort <level>        Reasoning effort (low, medium, high, max)
  --system-prompt <text>  System prompt
  --theme <id>            Theme preset (dark, high-contrast, catppuccin, dracula, solarized)
  --debug                 Enable debug output
  --debug-backend         Write raw backend JSONL trace
  --acp-command <cmd>     ACP agent command (for --backend acp)
  --acp-args <args>       ACP agent args (repeatable, for --backend acp)
  --no-diagnostics-mcp    Disable the MCP diagnostics server
`)
}
