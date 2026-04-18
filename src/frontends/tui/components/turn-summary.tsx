import { Show, For } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { colors } from "../theme/tokens"
import { truncatePathMiddle } from "../../../utils/truncate"
import type { TurnFileChange } from "../../../protocol/types"

const ACTION_ICONS: Record<string, string> = {
  create: "+",
  edit: "~",
  read: " ",
  write: "+",
}

function actionColor(action: string): string {
  switch (action) {
    case "create": return colors.diff.added
    case "edit":   return colors.accent.primary
    case "read":   return colors.text.muted
    case "write":  return colors.diff.added
    default:       return colors.text.muted
  }
}

export function TurnSummary(props: { files: TurnFileChange[] }) {
  // Deduplicate by path (keep most significant action: create > edit > read)
  const deduped = () => {
    const map = new Map<string, TurnFileChange>()
    const priority: Record<string, number> = { create: 3, edit: 2, write: 2, read: 1 }
    for (const f of props.files) {
      const existing = map.get(f.path)
      if (!existing || (priority[f.action] ?? 0) > (priority[existing.action] ?? 0)) {
        map.set(f.path, f)
      }
    }
    return [...map.values()].filter(f => f.action !== "read") // Only show writes/edits
  }

  return (
    <Show when={deduped().length > 0}>
      <box flexDirection="column" paddingLeft={2} marginTop={1}>
        <text fg={colors.text.muted}>
          {"Files changed:"}
        </text>
        <For each={deduped()}>
          {(file) => {
            const icon = ACTION_ICONS[file.action] ?? " "
            const color = actionColor(file.action)
            const rel = file.path.startsWith(process.cwd() + "/")
              ? file.path.slice(process.cwd().length + 1)
              : file.path
            return (
              <text fg={color} attributes={TextAttributes.DIM}>
                {"  " + icon + " " + truncatePathMiddle(rel, 70)}
              </text>
            )
          }}
        </For>
      </box>
    </Show>
  )
}
