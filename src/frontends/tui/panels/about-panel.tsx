/**
 * AboutPanel — about dialog shown as a modal overlay.
 *
 * Consumed by the TUI `FrontendBridge` when a command calls
 * `ctx.frontend?.openPanel("about")`.
 */

import { TextAttributes } from "@opentui/core"
import { colors } from "../theme/tokens"
import { ShortcutHint } from "../components/primitives"

export function AboutPanel() {
  return (
    <box flexDirection="column" padding={2}>
      <box borderStyle="single" borderColor={colors.border.default} flexDirection="column" padding={2}>
        <text fg={colors.accent.primary} attributes={TextAttributes.BOLD}>
          {"bantai"}
        </text>
        <text fg={colors.text.secondary}>
          {"Open-source terminal UI for agentic coding backends"}
        </text>

        <box marginTop={1} flexDirection="column">
          <text fg={colors.text.secondary}>{"  Version:   v0.0.1"}</text>
          <text fg={colors.text.secondary}>{`  Runtime:   Bun ${typeof Bun !== "undefined" ? Bun.version : "unknown"}`}</text>
          <text fg={colors.text.secondary}>{"  UI:        SolidJS + OpenTUI"}</text>
          <text fg={colors.text.secondary}>{`  Platform:  ${process.platform}/${process.arch}`}</text>
        </box>

        <box marginTop={1}>
          <text fg={colors.text.secondary}>{"  Licensed under MIT"}</text>
        </box>

        <box marginTop={1}>
          <ShortcutHint shortcut="Esc" action="close" parens />
        </box>
      </box>
    </box>
  )
}
