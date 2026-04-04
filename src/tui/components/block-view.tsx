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
import { Divider, getStatusConfig, BlinkingDot } from "./primitives"
import { truncatePathMiddle, truncateToWidth } from "../../utils/truncate"
import { UserBlock } from "./blocks/user-block"
import { AssistantBlock } from "./blocks/assistant-block"
import { SystemBlock, type SystemCategory, categorizeSystemMessage } from "./blocks/system-block"
import { ErrorBlock } from "./blocks/error-block"
import { CompactBlock } from "./blocks/compact-block"
import { ShellBlock } from "./blocks/shell-block"

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
  const shellBlock = () => b().type === "shell" ? b() as Extract<Block, { type: "shell" }> : null
  const errorBlock = () => b().type === "error" ? b() as Extract<Block, { type: "error" }> : null

  return (
    <box flexDirection="column">
      <Show when={userBlock()}>{(ub) =>
        <box marginTop={1}>
          <Show when={props.prevType && props.prevType !== "user"}>
            <Divider width={60} />
          </Show>
          <UserBlock block={ub()} />
        </box>
      }</Show>
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
      <Show when={shellBlock()}>{(sb) => <ShellBlock block={sb()} viewLevel={props.viewLevel} />}</Show>
      <Show when={compactBlock()}>{(cb) => <CompactBlock block={cb()} />}</Show>
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
      const rel = raw.startsWith(cwd + "/") ? raw.slice(cwd.length + 1) : raw
      return ` ${truncatePathMiddle(rel, 60)}`
    }
    if (inp.command) {
      return ` ${truncateToWidth(String(inp.command), 60)}`
    }
    if (inp.pattern) return ` ${String(inp.pattern)}`
    return ""
  }

  const hint = () => {
    if (displayRunning()) {
      const out = b().output ?? ""
      if (out) {
        const lines = out.split('\n').filter((l: string) => l.trim())
        const lastLine = lines[lines.length - 1] ?? ""
        const truncated = lastLine.length > 50 ? lastLine.slice(0, 47) + "..." : lastLine
        const lineCount = lines.length
        const secs = elapsed()
        const timeStr = secs > 0 ? ` (${secs}s)` : ""
        return `... ${truncated} [${lineCount} line${lineCount === 1 ? "" : "s"}${timeStr}]`
      }
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

  /** BlinkingDot status for the prefix gutter */
  const dotStatus = (): "active" | "success" | "error" | "declined" => {
    if (displayRunning()) return "active"
    if (b().error) {
      if (isUserDecline(b().error!)) return "declined"
      return "error"
    }
    return "success"
  }

  const isError = () => !!(b().error && !isUserDecline(b().error!))

  return (
    <box flexDirection="row">
      <box width={2} flexShrink={0}>
        <BlinkingDot status={dotStatus()} />
      </box>
      <text
        fg={isError() ? colors.status.error : colors.text.secondary}
        attributes={TextAttributes.DIM}
      >
        {b().tool + primaryArg() + hint()}
      </text>
    </box>
  )
}
