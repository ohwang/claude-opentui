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
}

export function parseFlags(argv: string[]): CLIFlags {
  const args = argv.slice(2) // Skip bun and script path

  const flags: CLIFlags = {
    config: {},
    backend: "claude",
    help: false,
    version: false,
    debug: false,
  }

  let i = 0
  while (i < args.length) {
    const arg = args[i]

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

      // Session management
      case "--continue":
      case "-c":
        flags.config.continue = true
        break

      case "--resume":
      case "-r":
        flags.config.resume = args[++i]
        break

      // Model & execution
      case "--model":
      case "-m":
        flags.config.model = args[++i]
        break

      case "--permission-mode":
        flags.config.permissionMode = args[++i] as PermissionMode
        break

      // Limits
      case "--max-turns":
        flags.config.maxTurns = parseInt(args[++i], 10)
        break

      case "--max-budget":
        flags.config.maxBudgetUsd = parseFloat(args[++i])
        break

      // Working directory
      case "--cwd":
        flags.config.cwd = args[++i]
        break

      // System prompt
      case "--system-prompt":
        flags.config.systemPrompt = args[++i]
        break

      // Backend selection
      case "--backend":
      case "-b":
        flags.backend = args[++i]
        break

      // Prompt
      case "--prompt":
      case "-p":
        flags.prompt = args[++i]
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
  -b, --backend <name>    Backend (claude, claude-v2)
  --permission-mode <m>   Permission mode (default, acceptEdits, bypassPermissions, plan, dontAsk)
  --max-turns <n>         Maximum turns
  --max-budget <usd>      Maximum budget in USD
  --cwd <path>            Working directory
  --system-prompt <text>  System prompt
  --debug                 Enable debug output
`)
}
