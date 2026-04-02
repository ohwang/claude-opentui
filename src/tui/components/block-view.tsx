/**
 * BlockView — thin dispatcher that routes each block to its renderer.
 *
 * Per-type renderers live in ./blocks/. This file handles the dispatch,
 * turn separators, and the CollapsedToolLine (which has complex state).
 */

import { Show, createSignal, createEffect, onCleanup } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { ThinkingBlock } from "./thinking-block"
import { ToolBlockView, isUserDecline } from "./tool-view"
import { colors } from "../theme/tokens"
import type { Block } from "../../protocol/types"
import type { ViewLevel } from "./tool-view"
import { Divider } from "./primitives"
import { UserBlock } from "./blocks/user-block"
import { AssistantBlock } from "./blocks/assistant-block"
import { SystemBlock, type SystemCategory, categorizeSystemMessage } from "./blocks/system-block"
import { ErrorBlock } from "./blocks/error-block"
import { CompactBlock } from "./blocks/compact-block"

// Re-export for consumers that import from block-view
export type { SystemCategory }
export { categorizeSystemMessage }

export function BlockView(props: { block: Block; viewLevel: ViewLevel; prevType?: string; showThinking?: boolean }) {
  const b = () => props.block

  // Typed narrowing helpers
  const userBlock = () => b().type === "user" ? b() as Extract<Block, { type: "user" }> : null
  const assistantBlock = () => b().type === "assistant" ? b() as Extract<Block, { type: "assistant" }> : null
  const thinkingBlock = () => b().type === "thinking" ? b() as Extract<Block, { type: "thinking" }> : null
  const toolBlock = () => b().type === "tool" ? b() as Extract<Block, { type: "tool" }> : null
  const systemBlock = () => b().type === "system" ? b() as Extract<Block, { type: "system" }> : null
  const compactBlock = () => b().type === "compact" ? b() as Extract<Block, { type: "compact" }> : null
  const errorBlock = () => b().type === "error" ? b() as Extract<Block, { type: "error" }> : null

  return (
    <box flexDirection="column">
      {/* Turn separator — subtle line between turns */}
      <Show when={b().type === "user" && props.prevType && props.prevType !== "user"}>
        <Divider width={60} />
      </Show>

      <Show when={userBlock()}>{(ub) => <UserBlock block={ub()} />}</Show>
      <Show when={assistantBlock()}>{(ab) => <AssistantBlock block={ab()} />}</Show>

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

      <Show when={systemBlock()}>{(sb) => <SystemBlock block={sb()} />}</Show>
      <Show when={compactBlock()}>{() => <CompactBlock />}</Show>
      <Show when={errorBlock()}>{(eb) => <ErrorBlock block={eb()} />}</Show>
    </box>
  )
}

/** Collapsed single-line tool summary — avoids destroying/recreating ToolBlockView on view toggle.
 *
 * Each line gets a status icon prefix for instant scannability:
 *   ✓ = success (green), ✗ = error (red), ⋯ = running (accent), ↳ = declined (dim)
 *
 * This matches the visual density of polished terminal UIs where every tool
 * invocation is instantly identifiable by its outcome without expanding.
 */
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
    if (inp.file_path) {
      const raw = String(inp.file_path)
      const cwd = process.cwd()
      const display = raw.startsWith(cwd + "/") ? raw.slice(cwd.length + 1) : raw
      return ` ${display}`
    }
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

  /** Status icon and color for the prefix gutter (uses displayRunning for min-display-time) */
  const statusIcon = () => {
    if (displayRunning()) return { icon: "\u22EF", color: colors.accent.primary }  // ⋯
    if (b().error) {
      if (isUserDecline(b().error!)) return { icon: "\u21B3", color: colors.text.muted }   // ↳
      return { icon: "\u2717", color: colors.status.error }                                 // ✗
    }
    return { icon: "\u2713", color: colors.status.success }                                 // ✓
  }

  const isError = () => !!(b().error && !isUserDecline(b().error!))

  return (
    <box flexDirection="row">
      <text
        fg={statusIcon().color}
        attributes={TextAttributes.DIM}
      >
        {statusIcon().icon + " "}
      </text>
      <text
        fg={isError() ? colors.status.error : colors.text.secondary}
        attributes={TextAttributes.DIM}
      >
        {b().tool + primaryArg() + hint()}
      </text>
    </box>
  )
}
