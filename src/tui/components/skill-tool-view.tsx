/**
 * SkillToolView — Specialized renderer for Skill tool blocks.
 *
 * Unlike generic ToolBlockView, this component renders skill invocations
 * with the skill name as the prominent label, and groups the skill's
 * loading/progress messages under the block rather than in the top-level
 * conversation flow.
 */

import { createSignal, createEffect, createMemo, onCleanup, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import type { Block } from "../../protocol/types"
import { colors } from "../theme/tokens"
import { BlinkingDot } from "./primitives"
import { truncateToWidth } from "../../utils/truncate"
import { formatDuration } from "../../utils/format"
import { isUserDecline } from "./tool-view"
import type { ViewLevel } from "./tool-view"

export type SkillToolBlock = Extract<Block, { type: "tool" }>

/** Extract the skill name from the Skill tool input */
function extractSkillName(input: unknown): string {
  const inp = input as Record<string, unknown> | null
  if (!inp) return ""
  if (inp.skill && typeof inp.skill === "string") return inp.skill
  return ""
}

/** Extract the skill args from the Skill tool input */
function extractSkillArgs(input: unknown): string {
  const inp = input as Record<string, unknown> | null
  if (!inp) return ""
  if (inp.args && typeof inp.args === "string") return inp.args
  return ""
}

/** Get the last N non-empty lines from text */
function getLastNLines(text: string, n: number): string {
  const lines = text.split("\n").filter(l => l.trim())
  if (lines.length <= n) return lines.join("\n")
  return "...\n" + lines.slice(-n).join("\n")
}

export function SkillToolView(props: {
  block: SkillToolBlock
  viewLevel: ViewLevel
}) {
  const b = () => props.block

  // Elapsed time for running skills
  const [elapsed, setElapsed] = createSignal(0)
  let elapsedTimer: ReturnType<typeof setInterval> | undefined

  createEffect(() => {
    if (b().status === "running") {
      setElapsed(Math.floor((Date.now() - b().startTime) / 1000))
      elapsedTimer = setInterval(() => {
        setElapsed(Math.floor((Date.now() - b().startTime) / 1000))
      }, 1000)
    } else {
      if (elapsedTimer) {
        clearInterval(elapsedTimer)
        elapsedTimer = undefined
      }
    }
  })
  onCleanup(() => { if (elapsedTimer) clearInterval(elapsedTimer) })

  const skillName = createMemo(() => extractSkillName(b().input))
  const skillArgs = createMemo(() => extractSkillArgs(b().input))

  const dotStatus = (): "active" | "success" | "error" => {
    if (b().status === "running") return "active"
    if (b().status === "error" || b().error) return "error"
    return "success"
  }

  // Progress: last few lines of output while running
  const progressText = createMemo(() => {
    if (b().status !== "running") return ""
    const out = b().output ?? ""
    if (!out) return ""
    return getLastNLines(out, 3)
  })

  // Completion summary: first meaningful line of output
  const completionSummary = createMemo(() => {
    if (b().status === "running") return ""
    const out = b().output ?? ""
    if (!out) return ""
    const firstLine = out.split("\n").find(l => l.trim()) ?? ""
    return firstLine.length > 120 ? firstLine.slice(0, 117) + "..." : firstLine
  })

  return (
    <box flexDirection="column">
      {/* Header: ● Skill — skill-name */}
      <box flexDirection="row">
        <box width={2} flexShrink={0}>
          <BlinkingDot status={dotStatus()} />
        </box>
        <text fg={colors.accent.suggestion} attributes={TextAttributes.BOLD}>
          {"Skill"}
        </text>
        <Show when={skillName()}>
          <text fg={colors.text.inactive}>
            {" " + skillName()}
          </text>
        </Show>
        <Show when={skillArgs()}>
          <text fg={colors.text.inactive} attributes={TextAttributes.DIM}>
            {" " + truncateToWidth(skillArgs(), 60)}
          </text>
        </Show>
        <Show when={b().status === "running" && elapsed() > 0}>
          <text fg={colors.text.inactive}>
            {" " + formatDuration(elapsed() * 1000, { hideTrailingZeros: true })}
          </text>
        </Show>
        <Show when={b().status !== "running" && b().duration !== undefined && b().duration! >= 1000}>
          <text fg={colors.text.inactive}>
            {" " + formatDuration(b().duration!, { hideTrailingZeros: true })}
          </text>
        </Show>
      </box>

      {/* Progress output — last few lines while skill is loading */}
      <Show when={props.viewLevel !== "collapsed" && b().status === "running" && progressText()}>
        <box paddingLeft={4}>
          <text fg={colors.text.inactive} attributes={TextAttributes.DIM}>
            {progressText()}
          </text>
        </box>
      </Show>

      {/* Completion result (expanded/show_all, done only) */}
      <Show when={props.viewLevel !== "collapsed" && b().status !== "running" && completionSummary()}>
        <box paddingLeft={2}>
          <text fg={colors.text.inactive} attributes={TextAttributes.DIM}>
            {"\u23BF  " + completionSummary()}
          </text>
        </box>
      </Show>

      {/* Full output (show_all mode) */}
      <Show when={props.viewLevel === "show_all" && b().output}>
        <box paddingLeft={4}>
          <text fg={colors.text.inactive}>
            {b().output}
          </text>
        </box>
      </Show>

      {/* Error display */}
      <Show when={b().error && !isUserDecline(b().error!)}>
        <box paddingLeft={2}>
          <text fg={colors.status.error}>
            {"\u23BF  \u2717 " + (b().error!.split("\n")[0]!.length > 100
              ? b().error!.split("\n")[0]!.slice(0, 97) + "..."
              : b().error!.split("\n")[0]!)}
          </text>
        </box>
      </Show>
      {/* User-initiated decline */}
      <Show when={b().error && isUserDecline(b().error!)}>
        <box paddingLeft={2}>
          <text fg={colors.text.inactive} attributes={TextAttributes.DIM}>
            {"\u21B3 " + b().error!.split("\n")[0]}
          </text>
        </box>
      </Show>
    </box>
  )
}

/** Collapsed single-line view for Skill tool blocks */
export function CollapsedSkillLine(props: {
  block: SkillToolBlock
}) {
  const b = () => props.block

  // Elapsed time
  const [elapsed, setElapsed] = createSignal(0)
  let elapsedTimer: ReturnType<typeof setInterval> | undefined

  createEffect(() => {
    if (b().status === "running") {
      setElapsed(Math.floor((Date.now() - b().startTime) / 1000))
      elapsedTimer = setInterval(() => {
        setElapsed(Math.floor((Date.now() - b().startTime) / 1000))
      }, 1000)
    } else {
      if (elapsedTimer) {
        clearInterval(elapsedTimer)
        elapsedTimer = undefined
      }
    }
  })
  onCleanup(() => { if (elapsedTimer) clearInterval(elapsedTimer) })

  const skillName = createMemo(() => extractSkillName(b().input))

  const dotStatus = (): "active" | "success" | "error" | "declined" => {
    if (b().status === "running") return "active"
    if (b().error) {
      if (isUserDecline(b().error!)) return "declined"
      return "error"
    }
    return "success"
  }

  const hint = createMemo(() => {
    if (b().status === "running") {
      return elapsed() > 0 ? ` (${elapsed()}s)` : ""
    }
    if (b().error) {
      return isUserDecline(b().error!) ? " — declined" : " — failed"
    }
    const out = b().output ?? ""
    if (out) {
      const firstLine = out.split("\n").find(l => l.trim()) ?? ""
      const truncated = firstLine.length > 50 ? firstLine.slice(0, 47) + "..." : firstLine
      return truncated ? ` — ${truncated}` : ""
    }
    return ""
  })

  const label = createMemo(() => {
    const name = skillName()
    return name ? `Skill ${truncateToWidth(name, 60)}` : "Skill"
  })

  return (
    <box flexDirection="row">
      <box width={2} flexShrink={0}>
        <BlinkingDot status={dotStatus()} />
      </box>
      <text
        fg={b().error && !isUserDecline(b().error!) ? colors.status.error : colors.accent.suggestion}
        attributes={TextAttributes.DIM}
      >
        {label() + hint()}
      </text>
    </box>
  )
}
