/**
 * AssistantBlock — renders assistant text with markdown and record indicator.
 */

import { syntaxStyle } from "../../theme/syntax"
import { colors } from "../../theme/tokens"
import type { Block } from "../../../protocol/types"

type AssistantBlockType = Extract<Block, { type: "assistant" }>

export function AssistantBlock(props: { block: AssistantBlockType }) {
  const b = () => props.block
  return (
    <box flexDirection="column">
      <box flexDirection="row" marginTop={1}>
        <box width={2} flexShrink={0}>
          <text fg={colors.text.white}>{"\u23FA"}</text>
        </box>
        <box flexGrow={1}>
          <markdown content={b().text} syntaxStyle={syntaxStyle} fg={colors.text.primary} />
        </box>
      </box>
    </box>
  )
}
