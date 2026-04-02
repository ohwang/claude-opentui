/**
 * ErrorBlock — prominent bordered error display.
 *
 * Strips stack traces and caps message length for clean display.
 */

import { TextAttributes } from "@opentui/core"
import { colors } from "../../theme/tokens"
import type { Block } from "../../../protocol/types"

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
    <box flexDirection="column" paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} borderStyle="single" borderColor={colors.border.error}>
      <text fg={colors.status.error} attributes={TextAttributes.BOLD}>Error: {b().code}</text>
      <text fg={colors.status.error}>{displayMessage()}</text>
    </box>
  )
}
