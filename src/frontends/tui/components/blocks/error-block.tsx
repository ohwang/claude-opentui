/**
 * ErrorBlock — prominent bordered error display.
 *
 * Strips stack traces and caps message length for clean display.
 */

import { colors } from "../../theme/tokens"
import type { Block } from "../../../../protocol/types"

type ErrorBlockType = Extract<Block, { type: "error" }>

export function ErrorBlock(props: { block: ErrorBlockType }) {
  const b = () => props.block
  // Defensive: strip any remaining stack traces and cap length
  const displayMessage = () => {
    const msg = b().message
    const lines = msg.split("\n").filter((l: string) => !l.match(/^\s+at\s/))
    const clean = lines.join("\n").trim()
    return clean.length > 300 ? clean.slice(0, 297) + "..." : clean
  }
  return (
    <box flexDirection="column" paddingLeft={2}>
      <text fg={colors.status.error}>{"\u2717 " + b().code + ": " + displayMessage()}</text>
    </box>
  )
}
