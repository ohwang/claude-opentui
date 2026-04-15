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
 * Logo: angular cat face in block characters.
 *
 * Visual:
 *
 *   /▛████▜\
 *    ▀████▀
 *    ▝▘  ▝▘
 *
 * 3 lines tall. Fox-eared cat — sharp ears with solid block body.
 */
const LOGO_LINES = [
  " /▛████▜\\ ",  // ears + head
  "  ▀████▀  ",  // face
  "  ▝▘  ▝▘  ",  // paws
]

export function HeaderBar() {
  const { state } = useSession()
  const agent = useAgent()

  // Use the CWD from config (captured at launch) rather than process.cwd(),
  // which may have been changed by the SDK or plugins after startup.
  const projectPath = resolve(agent.config.cwd ?? process.cwd()).replace(homedir(), "~")

  const backendLabel = () => {
    const caps = agent.backend.capabilities()
    return caps.sdkVersion ? `${caps.name} ${caps.sdkVersion}` : caps.name
  }

  const modelInfo = () => {
    // Prefer currentModel (set by Ctrl+P model cycling), then session metadata.
    // We intentionally do NOT fall back to `agent.config.model`: it can be
    // populated from settings (e.g. `~/.claude/settings.json`) regardless of
    // the active backend, which would display a Claude model name for Codex
    // sessions before session_init arrives. Better to admit we don't know
    // yet than to pretend.
    const model = state.session?.models?.[0]
    const raw = state.currentModel || model?.name || ""

    // No model reported by the backend yet — show the backend name alongside
    // an honest "unknown model" label while we wait for session_init.
    if (!raw) return `unknown model (${agent.backend.capabilities().name})`

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
    <box flexDirection="column" flexShrink={0}>
      {/* Row 0: head + tail + app name + version */}
      <box flexDirection="row">
        <text fg={colors.accent.logo}>{LOGO_LINES[0]}</text>
        <text fg={colors.accent.logo} attributes={TextAttributes.BOLD}>{"bantai"}</text>
        <text fg={colors.text.secondary}>{`  v0.0.1 (${backendLabel()})`}</text>
      </box>
      {/* Row 1: body + model info */}
      <box flexDirection="row">
        <text fg={colors.accent.logo}>{LOGO_LINES[1]}</text>
        <text fg={colors.text.secondary}>{modelInfo()}</text>
      </box>
      {/* Row 2: legs + working directory */}
      <box flexDirection="row">
        <text fg={colors.accent.logo}>{LOGO_LINES[2]}</text>
        <text fg={colors.text.secondary}>{projectPath}</text>
      </box>
    </box>
  )
}
