/**
 * CompactBlock — visual marker for context compaction.
 */

import { TextAttributes } from "@opentui/core"
import { colors } from "../../theme/tokens"

export function CompactBlock() {
  return (
    <box paddingTop={1} paddingBottom={1} paddingLeft={2}>
      <text fg={colors.text.muted} attributes={TextAttributes.DIM}>
        {"\u2500\u2500 Context compacted \u2500\u2500"}
      </text>
    </box>
  )
}
