/**
 * BlockView — dispatches rendering by block type.
 *
 * Routes each block to the appropriate visual treatment:
 * user, assistant, thinking, tool, system, compact, error.
 */

import { Show, createSignal, createEffect, onCleanup } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { ThinkingBlock } from "./thinking-block"
import { ToolBlockView, isUserDecline } from "./tool-view"
import { syntaxStyle } from "../theme"
import { colors } from "../theme/tokens"
import type { Block } from "../../protocol/types"
import type { ViewLevel } from "./tool-view"

// ---------------------------------------------------------------------------
// System message visual categorization
// ---------------------------------------------------------------------------

export type SystemCategory = "interrupt" | "denial" | "error" | "success" | "info"

export function categorizeSystemMessage(text: string): SystemCategory {
  const lower = text.toLowerCase()
  if (lower.includes("interrupted") || lower.includes("interrupt")) return "interrupt"
  if (lower.includes("denied")) return "denial"
  if (lower.includes("failed") || lower.includes("error") || lower.includes("cannot")) return "error"
  if (lower.includes("copied") || lower.includes("switched") || lower.includes("cleared") || lower.includes("connected")) return "success"
  return "info"
}

function systemMessageStyle(text: string): { icon: string; color: string; attrs: number } {
  switch (categorizeSystemMessage(text)) {
    case "interrupt": return { icon: "\u23BF", color: colors.status.warning, attrs: TextAttributes.BOLD }
    case "denial":    return { icon: "\u2717", color: colors.status.warning, attrs: TextAttributes.DIM }
    case "error":     return { icon: "\u2717", color: colors.status.error,   attrs: 0 }
    case "success":   return { icon: "\u2713", color: colors.status.success, attrs: TextAttributes.DIM }
    default:          return { icon: "\u00B7", color: colors.text.muted,     attrs: TextAttributes.DIM }
  }
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

      {/* System block — visually categorized by content */}
      <Show when={systemBlock()}>{(sb) => {
        const style = () => systemMessageStyle(sb().text)
        return (
          <box paddingLeft={2} marginTop={1}>
            <text fg={style().color} attributes={style().attrs}>
              {style().icon + " " + sb().text}
            </text>
          </box>
        )
      }}</Show>

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

  // --- Minimum display time: keep showing "running" for at least 700ms after completion ---
  const MIN_DISPLAY_MS = 700
  const [displayRunning, setDisplayRunning] = createSignal(b().status === "running")
  let minDisplayTimer: ReturnType<typeof setTimeout> | undefined

  createEffect(() => {
    if (b().status === "running") {
      setDisplayRunning(true)
      clearTimeout(minDisplayTimer)
    } else {
      // Tool completed — delay the visual transition
      minDisplayTimer = setTimeout(() => setDisplayRunning(false), MIN_DISPLAY_MS)
    }
  })
  onCleanup(() => clearTimeout(minDisplayTimer))

  // --- Elapsed time for running tools — updates every second ---
  const [elapsed, setElapsed] = createSignal(0)
  let elapsedTimer: ReturnType<typeof setInterval> | undefined

  createEffect(() => {
    if (displayRunning() && b().status === "running") {
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
    if (displayRunning()) {
      const secs = elapsed()
      return secs > 0 ? `... ${secs}s` : "..."
    }
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
