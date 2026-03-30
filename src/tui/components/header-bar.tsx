/**
 * Header Bar — Claude Code-style multi-line logo block
 *
 * Displays:
 * - ASCII logo in salmon/pink (ANSI 174) + app name
 * - Version info
 * - Model name + context window
 * - Working directory (shortened with ~)
 */

import { homedir } from "node:os"
import { TextAttributes } from "@opentui/core"
import { useSession } from "../context/session"
import { useAgent } from "../context/agent"

const MODEL_NAMES: Record<string, string> = {
  "claude-opus-4-6": "Opus 4.6",
  "claude-sonnet-4-6": "Sonnet 4.6",
  "claude-haiku-4-5-20251001": "Haiku 4.5",
  "claude-sonnet-4-5-20250514": "Sonnet 4.5",
  "claude-3-5-sonnet-20241022": "Sonnet 3.5",
  "claude-3-5-haiku-20241022": "Haiku 3.5",
}

function friendlyModelName(name: string): string {
  if (MODEL_NAMES[name]) return MODEL_NAMES[name]
  return name.replace(/^[Cc]laude\s+/, "")
}

export function HeaderBar() {
  const { state } = useSession()
  const agent = useAgent()

  const projectPath = process.cwd().replace(homedir(), "~")

  const modelInfo = () => {
    // Prefer session metadata model name, fall back to config
    const model = state.session?.models?.[0]
    const raw = model?.name ?? agent.config.model ?? "claude"
    const friendly = friendlyModelName(raw)
    // Append plan info if available (e.g., "Opus 4.6 · Claude Max")
    const plan = state.session?.account?.plan
    if (plan) return `${friendly} · ${plan}`
    return friendly
  }

  return (
    <box flexDirection="column" flexShrink={0} paddingBottom={1}>
      {/* Logo line 1 */}
      <box flexDirection="row">
        <text fg="#d78787">{" ╭━━━╮"}</text>
      </box>
      {/* Logo line 2 + app name + version */}
      <box flexDirection="row">
        <text fg="#d78787">{" ┃   ┃  claude-opentui"}</text>
        <text fg="gray" attributes={TextAttributes.DIM}>{"  v0.0.1"}</text>
      </box>
      {/* Logo line 3 + model info */}
      <box flexDirection="row">
        <text fg="#d78787">{" ╰━━━╯  "}</text>
        <text fg="gray" attributes={TextAttributes.DIM}>{modelInfo()}</text>
      </box>
      {/* Working directory */}
      <box>
        <text fg="gray" attributes={TextAttributes.DIM}>{"        " + projectPath}</text>
      </box>
    </box>
  )
}
