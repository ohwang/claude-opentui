/**
 * Permission Dialog — Inline approve/deny/always allow
 *
 * Renders within the conversation flow when WAITING_FOR_PERM.
 * Key shortcuts: y=approve, n=deny, a=always allow, ?=details
 */

import { Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { usePermissions } from "../context/permissions"
import { useAgent } from "../context/agent"
import { useSession } from "../context/session"
import { useSync } from "../context/sync"

export function PermissionDialog() {
  const { state } = usePermissions()
  const { state: session } = useSession()
  const agent = useAgent()
  const sync = useSync()

  useKeyboard((event) => {
    if (session.sessionState !== "WAITING_FOR_PERM") return
    if (!state.pendingPermission) return

    const id = state.pendingPermission.id

    if (event.name === "y") {
      agent.backend.approveToolUse(id)
    } else if (event.name === "n" || event.name === "escape") {
      const toolName = state.pendingPermission.tool
      agent.backend.denyToolUse(id, "Denied by user")
      sync.pushEvent({
        type: "system_message",
        text: `Tool "${toolName}" denied by user`,
      })
    } else if (event.name === "a") {
      agent.backend.approveToolUse(id, { alwaysAllow: true })
    }
  })

  return (
    <Show when={state.pendingPermission}>
      {(perm) => {
        const inputStr = () => {
          try {
            return JSON.stringify(perm().input)
          } catch {
            return String(perm().input)
          }
        }
        return (
          <box flexDirection="column">
            <box height={1} paddingLeft={1}>
              <text fg="yellow" attributes={TextAttributes.BOLD}>
                {perm().tool}
              </text>
            </box>
            <box height={1} paddingLeft={1}>
              <text fg="white">
                {inputStr()}
              </text>
            </box>
            <box height={1} paddingLeft={1}>
              <text fg="gray">
                [y] approve  [n] deny  [a] always allow
              </text>
            </box>
          </box>
        )
      }}
    </Show>
  )
}
