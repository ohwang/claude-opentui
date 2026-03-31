/**
 * Header Bar — Pixel-art logo + app info
 *
 * Displays a pixel-art walking cat on the left with
 * app name, version, model info, and working directory on the right.
 *
 * Logo: A side-view cat walking, in warm orange (#d7875f).
 * Uses Unicode half-block characters (▀ ▄ █).
 */

import { homedir } from "node:os"
import { resolve } from "node:path"
import { TextAttributes } from "@opentui/core"
import { useSession } from "../context/session"
import { useAgent } from "../context/agent"
import { friendlyModelName, MODEL_CONTEXT_WINDOWS, DEFAULT_CONTEXT_WINDOW } from "../models"
import { colors } from "../theme/tokens"

/**
 * Pixel-art logo: side-view of a cute cat walking.
 *
 * Visual (each line is one row of the logo):
 *
 *   ▄▀▀▀▄    ▄▀▀
 *   █◕ ω▀▀▀▀█▄▀
 *    ╹ ╹  ╹ ╹
 *
 * 3 lines tall. A walking cat in profile with a big round head,
 * cute ◕ eye, ω cat mouth, and a tail curling up. Tiny stick legs.
 */
const LOGO_LINES = [
  " ▄▀▀▀▄    ▄▀▀  ",  // round head + tail curling up
  " █◕ ω▀▀▀▀█▄▀   ",  // face (eye + cat mouth) + body + tail
  "  ╹ ╹  ╹ ╹     ",  // tiny legs
]

const LOGO_COLOR = colors.accent.logo

export function HeaderBar() {
  const { state } = useSession()
  const agent = useAgent()

  // Use the CWD from config (captured at launch) rather than process.cwd(),
  // which may have been changed by the SDK or plugins after startup.
  const projectPath = resolve(agent.config.cwd ?? process.cwd()).replace(homedir(), "~")

  const modelInfo = () => {
    // Prefer currentModel (set by Ctrl+P model cycling), then session metadata,
    // then configured model. session_init only arrives after the first user
    // message (SDK starts lazily), so use agent.config.model as the initial
    // display to avoid showing "Connecting..." when a model is already configured.
    const model = state.session?.models?.[0]
    const raw = state.currentModel || (model?.name ?? agent.config.model ?? "")

    // No model from session or config — genuinely unknown
    if (!raw) return "Connecting..."

    const friendly = friendlyModelName(raw)

    // Prefer the SDK's dynamic context window (includes extended thinking),
    // fall back to the hardcoded map for pre-session-init or Ctrl+P model changes.
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

  // Text info lines aligned to logo rows (3 rows)
  return (
    <box flexDirection="column" flexShrink={0} paddingBottom={1}>
      {/* Row 0: head + tail + app name + version */}
      <box flexDirection="row">
        <text fg={LOGO_COLOR}>{LOGO_LINES[0]}</text>
        <text fg={LOGO_COLOR} attributes={TextAttributes.BOLD}>{"claude-opentui"}</text>
        <text fg={colors.text.muted} attributes={TextAttributes.DIM}>{"  v0.0.1"}</text>
      </box>
      {/* Row 1: body + model info */}
      <box flexDirection="row">
        <text fg={LOGO_COLOR}>{LOGO_LINES[1]}</text>
        <text fg={colors.text.muted} attributes={TextAttributes.DIM}>{modelInfo()}</text>
      </box>
      {/* Row 2: legs + working directory */}
      <box flexDirection="row">
        <text fg={LOGO_COLOR}>{LOGO_LINES[2]}</text>
        <text fg={colors.text.muted} attributes={TextAttributes.DIM}>{projectPath}</text>
      </box>
    </box>
  )
}
