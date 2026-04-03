/**
 * /about — Show about dialog as a modal overlay.
 *
 * First command to use the modal overlay system.
 * Demonstrates the pattern for rich command UIs.
 */

import { TextAttributes } from "@opentui/core"
import { showModal } from "../../tui/context/modal"
import { colors } from "../../tui/theme/tokens"
import type { SlashCommand } from "../registry"

function AboutModal() {
  return (
    <box flexDirection="column" padding={2}>
      <box borderStyle="single" borderColor={colors.border.default} flexDirection="column" padding={2}>
        <text fg={colors.accent.primary} attributes={TextAttributes.BOLD}>
          {"claude-opentui"}
        </text>
        <text fg={colors.text.secondary}>
          {"Open-source, drop-in replacement for Claude Code's terminal UI"}
        </text>

        <box marginTop={1} flexDirection="column">
          <text fg={colors.text.muted}>{"  Version:   v0.0.1"}</text>
          <text fg={colors.text.muted}>{`  Runtime:   Bun ${typeof Bun !== "undefined" ? Bun.version : "unknown"}`}</text>
          <text fg={colors.text.muted}>{"  UI:        SolidJS + OpenTUI"}</text>
          <text fg={colors.text.muted}>{`  Platform:  ${process.platform}/${process.arch}`}</text>
        </box>

        <box marginTop={1}>
          <text fg={colors.text.muted}>{"  Licensed under MIT"}</text>
        </box>

        <box marginTop={1}>
          <text fg={colors.text.muted} attributes={TextAttributes.DIM}>
            {"  Press Escape to close"}
          </text>
        </box>
      </box>
    </box>
  )
}

export const aboutCommand: SlashCommand = {
  name: "about",
  description: "Show about dialog",
  execute: () => {
    showModal(AboutModal)
  },
}
