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
}

/**
 * Validate that a flag's required value argument is present and not another flag.
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

      // Working directory
      case "--cwd":
        flags.config.cwd = requireArg("--cwd", args, ++i)
        break

      // System prompt
      case "--system-prompt":
        flags.config.systemPrompt = requireArg("--system-prompt", args, ++i)
        break

      // Backend selection
      case "--backend":
      case "-b":
        flags.backend = requireArg("--backend", args, ++i)
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
  -b, --backend <name>    Backend (claude, claude-v2, codex, codex-sdk, gemini, mock)
  --permission-mode <m>   Permission mode (default, acceptEdits, bypassPermissions, plan, dontAsk)
  --dangerously-skip-permissions  Shorthand for --permission-mode bypassPermissions
  --max-turns <n>         Maximum turns
  --max-budget <usd>      Maximum budget in USD
  --cwd <path>            Working directory
  --system-prompt <text>  System prompt
  --debug                 Enable debug output
  --debug-backend         Write raw backend JSONL trace
`)
}
