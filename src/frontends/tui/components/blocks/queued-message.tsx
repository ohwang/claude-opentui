/**
 * QueuedMessage — renders a queued user message (sent while agent is running).
 *
 * Shows a dimmed preview of the message with a "(queued)" suffix to indicate
 * it will be processed after the current turn completes.
 */

import { Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { colors } from "../../theme/tokens"
import type { Block } from "../../../../protocol/types"

type UserBlockType = Extract<Block, { type: "user" }>

export function QueuedMessage(props: { block: UserBlockType }) {
  const b = () => props.block
  return (
    <box flexDirection="column" marginTop={1}>
      <box flexDirection="row" paddingLeft={2}>
        <text fg={colors.text.muted}>
          {"\u276F "}
        </text>
        <text fg={colors.text.muted}>
          {b().text}
        </text>
        <text fg={colors.text.muted} attributes={TextAttributes.ITALIC}>
          {" (queued)"}
        </text>
      </box>
      <Show when={b().images && b().images!.length > 0}>
        <box paddingLeft={4}>
          <text fg={colors.text.muted}>
            {`\uD83D\uDCCE ${b().images!.length} image${b().images!.length === 1 ? "" : "s"} attached`}
          </text>
        </box>
      </Show>
    </box>
  )
}
