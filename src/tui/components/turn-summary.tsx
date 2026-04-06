import { Show, For } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { colors } from "../theme/tokens"
import { truncatePathMiddle } from "../../utils/truncate"
import type { TurnFileChange } from "../../protocol/types"

const ACTION_ICONS: Record<string, string> = {
  create: "+",
  edit: "~",
  read: " ",
  write: "+",
}

const ACTION_COLORS: Record<string, string> = {
  create: colors.diff.added,
  edit: colors.accent.primary,
  read: colors.text.inactive,
  write: colors.diff.added,
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
        <text fg={colors.text.inactive} attributes={TextAttributes.DIM}>
          {"Files changed:"}
        </text>
        <For each={deduped()}>
          {(file) => {
            const icon = ACTION_ICONS[file.action] ?? " "
            const color = ACTION_COLORS[file.action] ?? colors.text.inactive
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
