/**
 * UserBlock — renders a user message with prompt indicator and optional image count.
 */

import { Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { colors } from "../../theme/tokens"
import type { Block } from "../../../protocol/types"

type UserBlockType = Extract<Block, { type: "user" }>

export function UserBlock(props: { block: UserBlockType }) {
  const b = () => props.block
  return (
    <box flexDirection="column" marginTop={1}>
      <box flexDirection="row" flexGrow={1} bg={colors.bg.surface}>
        <box width={2} flexShrink={0}>
          <text fg={colors.text.white} attributes={TextAttributes.BOLD}>{"\u276F"}</text>
        </box>
        <box flexGrow={1}>
          <text fg={colors.text.white}>{b().text}</text>
        </box>
      </box>
      <Show when={b().images && b().images!.length > 0}>
        <box paddingLeft={2}>
          <text fg={colors.accent.primary} attributes={TextAttributes.DIM}>
            {`\uD83D\uDCCE ${b().images!.length} image${b().images!.length === 1 ? "" : "s"} attached`}
          </text>
        </box>
      </Show>
    </box>
  )
}
