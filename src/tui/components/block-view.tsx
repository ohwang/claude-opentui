/**
 * BlockView — dispatches rendering by block type.
 *
 * Routes each block to the appropriate visual treatment:
 * user, assistant, thinking, tool, system, compact, error.
 */

import { Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { ThinkingBlock } from "./thinking-block"
import { ToolBlockView, isUserDecline } from "./tool-view"
import { syntaxStyle } from "../theme"
import { colors } from "../theme/tokens"
import type { Block } from "../../protocol/types"
import type { ViewLevel } from "./tool-view"

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
        <box flexDirection="column" marginTop={1}>
          <box flexDirection="row" flexGrow={1} bg={colors.bg.surface}>
            <box width={2} flexShrink={0}>
              <text fg={colors.text.white} attributes={TextAttributes.BOLD}>{"❯"}</text>
            </box>
            <box flexGrow={1}>
              <text fg={colors.text.white}>{ub().text}</text>
            </box>
          </box>
          <Show when={ub().images && ub().images!.length > 0}>
            <box paddingLeft={2}>
              <text fg={colors.accent.primary} attributes={TextAttributes.DIM}>
                {`📎 ${ub().images!.length} image${ub().images!.length === 1 ? "" : "s"} attached`}
              </text>
            </box>
          </Show>
        </box>
      }</Show>

      {/* Assistant text block */}
      <Show when={assistantBlock()}>{(ab) =>
        <box flexDirection="column">
          <box flexDirection="row" marginTop={1}>
            <box width={2} flexShrink={0}>
              <text fg={colors.text.white}>{"\u23FA"}</text>
            </box>
            <box flexGrow={1}>
              <markdown content={ab().text} syntaxStyle={syntaxStyle} fg={colors.text.primary} />
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
          <Show
            when={props.viewLevel !== "collapsed"}
            fallback={<CollapsedToolLine block={tb()} />}
          >
            <ToolBlockView block={tb()} viewLevel={props.viewLevel} />
          </Show>
        </box>
      }</Show>

      {/* System block */}
      <Show when={systemBlock()}>{(sb) =>
        <box paddingLeft={2} marginTop={1}>
          <text fg={colors.text.muted} attributes={TextAttributes.DIM}>
            {sb().text}
          </text>
        </box>
      }</Show>

      {/* Compact block */}
      <Show when={compactBlock()}>
        <box paddingTop={1} paddingBottom={1} paddingLeft={2}>
          <text fg={colors.text.muted} attributes={TextAttributes.DIM}>
            {"\u2500\u2500 Context compacted \u2500\u2500"}
          </text>
        </box>
      </Show>

      {/* Error block */}
      <Show when={errorBlock()}>{(eb) => {
        // Defensive: strip any remaining stack traces and cap length
        const displayMessage = () => {
          const msg = eb().message
          const lines = msg.split("\n").filter((l: string) => !l.match(/^\s+at\s/))
          const clean = lines.join("\n").trim()
          return clean.length > 300 ? clean.slice(0, 297) + "..." : clean
        }
        return (
          <box flexDirection="column" paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} borderStyle="single" borderColor={colors.border.error}>
            <text fg={colors.status.error} attributes={TextAttributes.BOLD}>Error: {eb().code}</text>
            <text fg={colors.status.error}>{displayMessage()}</text>
          </box>
        )
      }}</Show>
    </box>
  )
}

/** Collapsed single-line tool summary — avoids destroying/recreating ToolBlockView on view toggle */
function CollapsedToolLine(props: { block: Extract<Block, { type: "tool" }> }) {
  const b = () => props.block

  const primaryArg = () => {
    const inp = b().input as Record<string, unknown> | null
    if (!inp) return ""
    if (inp.file_path) return ` ${String(inp.file_path)}`
    if (inp.command) {
      const cmd = String(inp.command)
      return ` ${cmd.length > 60 ? cmd.slice(0, 57) + "..." : cmd}`
    }
    if (inp.pattern) return ` ${String(inp.pattern)}`
    return ""
  }

  const hint = () => {
    if (b().status === "running") return "..."
    if (b().error) {
      return isUserDecline(b().error!) ? " — declined" : " — failed"
    }
    const out = b().output ?? ""
    if (!out) return ""
    if (b().tool === "Read" || b().tool === "Glob" || b().tool === "Grep") {
      const lines = out.trim().split("\n").filter((l: string) => l.trim()).length
      return ` — ${lines} result${lines === 1 ? "" : "s"}`
    }
    return ""
  }

  const isError = () => !!(b().error && !isUserDecline(b().error!))

  return (
    <text
      fg={isError() ? colors.status.error : colors.text.secondary}
      attributes={TextAttributes.DIM}
    >
      {b().tool + primaryArg() + hint()}
    </text>
  )
}
