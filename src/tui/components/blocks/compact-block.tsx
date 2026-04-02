/**
 * CompactBlock — visual marker for context compaction.
 *
 * Shows the compaction summary and a hint to expand history.
 * Inspired by Claude Code's CompactSummary component.
 */

import { Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { colors } from "../../theme/tokens"
import type { Block } from "../../../protocol/types"

type CompactBlockType = Extract<Block, { type: "compact" }>

export function CompactBlock(props: { block?: CompactBlockType }) {
  const summary = () => props.block?.summary ?? ""

  return (
    <box flexDirection="column" paddingTop={1} paddingBottom={1} paddingLeft={2}>
      <text fg={colors.text.muted} attributes={TextAttributes.BOLD}>
        {"── Summarized conversation ──"}
      </text>
      <Show when={summary()}>
        <box paddingLeft={2} marginTop={0}>
          <text fg={colors.text.muted} attributes={TextAttributes.DIM}>
            {summary()}
          </text>
        </box>
      </Show>
      <box paddingLeft={2}>
        <text fg={colors.text.muted} attributes={TextAttributes.DIM}>
          {"(ctrl+o to expand history)"}
        </text>
      </box>
    </box>
  )
}
