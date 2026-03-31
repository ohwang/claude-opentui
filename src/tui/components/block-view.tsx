/**
 * BlockView — dispatches rendering by block type.
 *
 * Routes each block to the appropriate visual treatment:
 * user, assistant, thinking, tool, system, compact, error.
 */

import { Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { ThinkingBlock } from "./thinking-block"
import { ToolBlockView } from "./tool-view"
import { syntaxStyle } from "../theme"
import type { Block } from "../../protocol/types"
import type { ViewLevel } from "./tool-view"
import { friendlyModelName } from "../models"

/** Format timestamp as "HH:MM AM/PM" for the expanded view metadata line */
export function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  let h = d.getHours()
  const ampm = h >= 12 ? "PM" : "AM"
  h = h % 12 || 12
  const m = d.getMinutes().toString().padStart(2, "0")
  return `${h.toString().padStart(2, "0")}:${m} ${ampm}`
}

export function BlockView(props: { block: Block; viewLevel: ViewLevel; prevType?: string; showThinking?: boolean }) {
  const b = () => props.block

  // Typed narrowing helpers — each returns the narrowed variant or null.
  // Used with <Show when={...}>{(val) => ...}</Show> so the callback
  // receives the non-null typed block, eliminating all `as any` casts.
  const userBlock = () => b().type === "user" ? b() as Extract<Block, { type: "user" }> : null
  const assistantBlock = () => b().type === "assistant" ? b() as Extract<Block, { type: "assistant" }> : null
  const thinkingBlock = () => b().type === "thinking" ? b() as Extract<Block, { type: "thinking" }> : null
  const toolBlock = () => b().type === "tool" ? b() as Extract<Block, { type: "tool" }> : null
  const systemBlock = () => b().type === "system" ? b() as Extract<Block, { type: "system" }> : null
  const compactBlock = () => b().type === "compact" ? b() as Extract<Block, { type: "compact" }> : null
  const errorBlock = () => b().type === "error" ? b() as Extract<Block, { type: "error" }> : null

  return (
    <box flexDirection="column">
      {/* User block */}
      <Show when={userBlock()}>{(ub) =>
        <box flexDirection="row" flexGrow={1} marginTop={1} paddingLeft={1} bg="#3a3a3a">
          <text fg="white" attributes={TextAttributes.BOLD}>{"❯ "}</text>
          <text fg="white">{ub().text}</text>
        </box>
      }</Show>

      {/* Assistant text block */}
      <Show when={assistantBlock()}>{(ab) =>
        <box flexDirection="column">
          {/* Timestamp + model line (expanded view only) */}
          <Show when={props.viewLevel !== "collapsed" && ab().timestamp}>
            <box flexDirection="row" justifyContent="flex-end" marginTop={1}>
              <text fg="gray" attributes={TextAttributes.DIM}>
                {formatTimestamp(ab().timestamp!) + (ab().model ? " " + friendlyModelName(ab().model) : "")}
              </text>
            </box>
          </Show>
          <box flexDirection="row" marginTop={props.viewLevel !== "collapsed" && ab().timestamp ? 0 : 1}>
            <box width={2} flexShrink={0}>
              <text fg="white">{"\u23FA"}</text>
            </box>
            <box flexGrow={1}>
              <markdown content={ab().text} syntaxStyle={syntaxStyle} fg="#e4e4e4" />
            </box>
          </box>
        </box>
      }</Show>

      {/* Thinking block — hidden in collapsed view or when thinking toggle is off */}
      <Show when={props.showThinking !== false && props.viewLevel !== "collapsed" && thinkingBlock()}>{(tb) =>
        <box marginTop={1}>
          <ThinkingBlock text={tb().text} collapsed={false} />
        </box>
      }</Show>

      {/* Tool block — tight grouping for consecutive tools */}
      <Show when={toolBlock()}>{(tb) =>
        <box marginTop={props.prevType !== "tool" ? 1 : 0}>
          <ToolBlockView block={tb()} viewLevel={props.viewLevel} />
        </box>
      }</Show>

      {/* System block */}
      <Show when={systemBlock()}>{(sb) =>
        <box paddingLeft={2} marginTop={1}>
          <text fg="gray" attributes={TextAttributes.DIM}>
            {sb().text}
          </text>
        </box>
      }</Show>

      {/* Compact block */}
      <Show when={compactBlock()}>
        <box paddingTop={1} paddingBottom={1}>
          <text fg="gray" attributes={TextAttributes.DIM}>
            {"\u2500\u2500 Context compacted \u2500\u2500"}
          </text>
        </box>
      </Show>

      {/* Error block */}
      <Show when={errorBlock()}>{(eb) =>
        <box flexDirection="column" paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} borderStyle="single" borderColor="red">
          <text fg="red" attributes={TextAttributes.BOLD}>Error: {eb().code}</text>
          <text fg="red">{eb().message}</text>
        </box>
      }</Show>
    </box>
  )
}
