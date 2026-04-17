/**
 * Minimal status bar preset — just the essentials.
 *
 * Line 1:
 *   project  model  ●state     [hint]
 *
 * No cost, git, context, rate-limits, or tok/s. For users who want a calm
 * status bar that doesn't move much and only surfaces the core identity of
 * what's running.
 */
import { TextAttributes } from "@opentui/core"
import { colors } from "../../theme/tokens"
import type { StatusBarPreset, StatusBarPresetProps } from "../types"

function MinimalStatusBar(props: StatusBarPresetProps) {
  const { data } = props
  return (
    <box height={1} flexDirection="row" paddingLeft={2} paddingRight={1}>
      <text fg={colors.text.secondary}>{data.projectName}</text>

      <text fg={colors.text.secondary}>{"  "}</text>

      <text fg={colors.text.primary} attributes={TextAttributes.BOLD}>
        {data.modelDisplay()}
      </text>

      <text fg={colors.text.secondary}>{"  "}</text>
      <text fg={data.stateColor()}>{data.stateIcon()}</text>
      {data.backgrounded() && (
        <text fg={colors.status.warning}>{" Backgrounded"}</text>
      )}

      <box flexGrow={1} />

      {props.hint && <text fg={colors.status.warning}>{props.hint}</text>}
    </box>
  )
}

export const minimalPreset: StatusBarPreset = {
  id: "minimal",
  name: "Minimal",
  description: "Just project, model, and state — no cost, git, context, or tok/s.",
  render: MinimalStatusBar,
}
