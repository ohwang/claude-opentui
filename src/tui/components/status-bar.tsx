/**
 * Status Bar — Model, cost, tokens, state indicator
 *
 * Fixed 1-line bar at the bottom of the TUI.
 */

import { useSession } from "../context/session"

export function StatusBar() {
  const { state } = useSession()

  const stateIcon = () => {
    switch (state.sessionState) {
      case "INITIALIZING":
        return "◌"
      case "IDLE":
        return "●"
      case "RUNNING":
        return "⟳"
      case "WAITING_FOR_PERM":
        return "⚠"
      case "WAITING_FOR_ELIC":
        return "?"
      case "INTERRUPTING":
        return "⏸"
      case "ERROR":
        return "✗"
      case "SHUTTING_DOWN":
        return "◌"
      default:
        return "●"
    }
  }

  const stateColor = () => {
    switch (state.sessionState) {
      case "IDLE":
        return "green"
      case "RUNNING":
        return "cyan"
      case "WAITING_FOR_PERM":
      case "WAITING_FOR_ELIC":
        return "yellow"
      case "INTERRUPTING":
        return "yellow"
      case "ERROR":
        return "red"
      default:
        return "gray"
    }
  }

  const modelName = () => state.session?.models?.[0]?.name ?? "claude"

  const costStr = () => {
    const c = state.cost.totalCostUsd
    if (c === 0) return ""
    return `$${c.toFixed(4)}`
  }

  const tokenStr = () => {
    const total = state.cost.inputTokens + state.cost.outputTokens
    if (total === 0) return ""
    if (total > 1000) return `${(total / 1000).toFixed(1)}k tokens`
    return `${total} tokens`
  }

  return (
    <box height={1} flexDirection="row" paddingLeft={1} paddingRight={1}>
      <text bold color="white">
        {modelName()}
      </text>
      <text color="gray">{" "}</text>
      <text color={stateColor()}>
        {stateIcon()}
      </text>
      <text color="gray">{" "}</text>
      <text color="gray">{costStr()}</text>
      <text color="gray">
        {costStr() && tokenStr() ? " " : ""}
        {tokenStr()}
      </text>
    </box>
  )
}
