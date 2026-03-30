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
import { friendlyModelName, MODEL_CONTEXT_WINDOWS, DEFAULT_CONTEXT_WINDOW } from "../models"

export function HeaderBar() {
  const { state } = useSession()
  const agent = useAgent()

  const projectPath = process.cwd().replace(homedir(), "~")

  const modelInfo = () => {
    // Prefer session metadata model name, fall back to config
    const model = state.session?.models?.[0]
    const raw = model?.name ?? agent.config.model ?? ""
    const friendly = friendlyModelName(raw)

    // Get context window from model metadata
    const ctxWindow = MODEL_CONTEXT_WINDOWS[raw] ?? DEFAULT_CONTEXT_WINDOW
    const ctxLabel = ctxWindow >= 1_000_000
      ? `${ctxWindow / 1_000_000}M context`
      : `${ctxWindow / 1_000}K context`

    // Build the model info line
    const parts = [friendly]
    if (raw) parts.push(`(${ctxLabel})`)  // Only show if model is known

    const plan = state.session?.account?.plan
    if (plan) parts.push(`- ${plan}`)

    return parts.join(" ")
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
        <text fg="gray" attributes={TextAttributes.DIM}>{modelInfo() || "Connecting..."}</text>
      </box>
      {/* Working directory */}
      <box>
        <text fg="gray" attributes={TextAttributes.DIM}>{"        " + projectPath}</text>
      </box>
    </box>
  )
}
