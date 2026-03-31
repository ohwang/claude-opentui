/**
 * Header Bar — Pixel-art logo + app info
 *
 * Displays a pixel-art terminal-face character on the left with
 * app name, version, model info, and working directory on the right.
 *
 * Logo: A cute terminal/monitor with eyes -- an "open terminal" mascot.
 * Uses Unicode half-block characters (▀ ▄ █ ▌ ▐) in salmon/pink (#d78787).
 */

import { homedir } from "node:os"
import { resolve } from "node:path"
import { TextAttributes } from "@opentui/core"
import { useSession } from "../context/session"
import { useAgent } from "../context/agent"
import { friendlyModelName, MODEL_CONTEXT_WINDOWS, DEFAULT_CONTEXT_WINDOW } from "../models"

/**
 * Pixel-art logo: a small terminal monitor with eyes and antenna.
 *
 * Visual (each line is one row of the logo):
 *
 *     ▄█▄
 *   ▄█████▄
 *   █ ▀ ▀ █
 *   ▀▄███▄▀
 *     ▀▀▀
 *
 * 5 lines tall, 9 chars wide. A terminal screen with two dot-eyes,
 * an antenna on top, and a small base. Distinct from Claude Code's
 * creature face -- this is a friendly open-source terminal mascot.
 */
const LOGO_LINES = [
  "   ▄█▄   ",  // antenna
  " ▄█████▄ ",  // top of screen
  " █ ▀ ▀ █ ",  // screen with eyes
  " ▀▄███▄▀ ",  // bottom of screen
  "   ▀▀▀   ",  // base/stand
]

export function HeaderBar() {
  const { state } = useSession()
  const agent = useAgent()

  // Use the CWD from config (captured at launch) rather than process.cwd(),
  // which may have been changed by the SDK or plugins after startup.
  const projectPath = resolve(agent.config.cwd ?? process.cwd()).replace(homedir(), "~")

  const modelInfo = () => {
    // Prefer session metadata model name, fall back to configured model.
    // session_init only arrives after the first user message (SDK starts lazily),
    // so use agent.config.model as the initial display to avoid showing
    // "Connecting..." when a model is already configured.
    const model = state.session?.models?.[0]
    const raw = model?.name ?? agent.config.model ?? ""

    // No model from session or config — genuinely unknown
    if (!raw) return "Connecting..."

    const friendly = friendlyModelName(raw)

    // Prefer dynamic context window from SDK, fall back to hardcoded
    const ctxWindow = model?.contextWindow ?? MODEL_CONTEXT_WINDOWS[raw] ?? DEFAULT_CONTEXT_WINDOW
    const ctxLabel = ctxWindow >= 1_000_000
      ? `${ctxWindow / 1_000_000}M context`
      : `${ctxWindow / 1_000}K context`

    // Build the model info line
    const parts = [friendly, `(${ctxLabel})`]

    const plan = state.session?.account?.plan
    if (plan) parts.push(`- ${plan}`)

    return parts.join(" ")
  }

  // Text info lines aligned to logo rows (centered vertically)
  // Logo has 5 rows; text occupies rows 1-3 (0-indexed), leaving
  // the antenna (row 0) and base (row 4) as logo-only rows.
  return (
    <box flexDirection="column" flexShrink={0} paddingBottom={1}>
      {/* Row 0: antenna only */}
      <box flexDirection="row">
        <text fg="#d78787">{LOGO_LINES[0]}</text>
      </box>
      {/* Row 1: top of screen + app name + version */}
      <box flexDirection="row">
        <text fg="#d78787">{LOGO_LINES[1]}</text>
        <text fg="#d78787" attributes={TextAttributes.BOLD}>{"claude-opentui"}</text>
        <text fg="#808080" attributes={TextAttributes.DIM}>{"  v0.0.1"}</text>
      </box>
      {/* Row 2: eyes + model info */}
      <box flexDirection="row">
        <text fg="#d78787">{LOGO_LINES[2]}</text>
        <text fg="#808080" attributes={TextAttributes.DIM}>{modelInfo()}</text>
      </box>
      {/* Row 3: bottom of screen + working directory */}
      <box flexDirection="row">
        <text fg="#d78787">{LOGO_LINES[3]}</text>
        <text fg="#808080" attributes={TextAttributes.DIM}>{projectPath}</text>
      </box>
      {/* Row 4: base only */}
      <box flexDirection="row">
        <text fg="#d78787">{LOGO_LINES[4]}</text>
      </box>
    </box>
  )
}
