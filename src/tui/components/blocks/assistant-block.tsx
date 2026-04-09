/**
 * AssistantBlock — renders assistant text with markdown and record indicator.
 *
 * Features a brief DIM→normal fade-in when the block first appears,
 * powered by the centralized AnimationContext.
 */

import { useAnimation, useReducedMotion } from "../../context/animation"
import { easeOut } from "../../theme/easing"
import { syntaxStyle } from "../../theme/syntax"
import { colors } from "../../theme/tokens"
import type { Block } from "../../../protocol/types"

type AssistantBlockType = Extract<Block, { type: "assistant" }>

/** Linearly interpolate a hex color channel */
function lerpHex(a: string, b: string, t: number): string {
  const parse = (hex: string) => {
    const h = hex.replace("#", "")
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ]
  }
  const ca = parse(a)
  const cb = parse(b)
  const r = Math.round(ca[0]! + (cb[0]! - ca[0]!) * t)
  const g = Math.round(ca[1]! + (cb[1]! - ca[1]!) * t)
  const b_ = Math.round(ca[2]! + (cb[2]! - ca[2]!) * t)
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b_.toString(16).padStart(2, "0")}`
}

export function AssistantBlock(props: { block: AssistantBlockType }) {
  const b = () => props.block
  const reducedMotion = useReducedMotion()
  const progress = useAnimation(300, { easing: easeOut })

  const textColor = () => {
    if (reducedMotion()) return colors.text.primary
    const t = progress()
    if (t >= 1) return colors.text.primary
    return lerpHex(colors.text.secondary, colors.text.primary, t)
  }

  const iconColor = () => {
    if (reducedMotion()) return colors.accent.primary
    const t = progress()
    if (t >= 1) return colors.accent.primary
    return lerpHex(colors.text.secondary, colors.accent.primary, t)
  }

  return (
    <box flexDirection="column">
      <box flexDirection="row">
        <box width={2} flexShrink={0}>
          <text fg={iconColor()}>{"\u23FA"}</text>
        </box>
        <box flexGrow={1}>
          <markdown content={b().text} syntaxStyle={syntaxStyle} fg={textColor()} />
        </box>
      </box>
    </box>
  )
}
