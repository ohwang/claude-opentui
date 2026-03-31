/**
 * Conversation View — Scrollbox with sticky scroll
 *
 * Renders all blocks, streaming content, active tools.
 * Uses OpenTUI stickyScroll for auto-following.
 * Ctrl+O toggles tool view level, Ctrl+E shows all.
 */

import type { JSX } from "solid-js"
import { createSignal, createEffect, createMemo, onCleanup, Show, For } from "solid-js"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useMessages } from "../context/messages"
import { useSession } from "../context/session"
import { ThinkingBlock } from "./thinking-block"
import { TaskView } from "./task-view"
import { syntaxStyle } from "../theme"
import { HeaderBar } from "./header-bar"
import type { Block } from "../../protocol/types"
import { friendlyModelName } from "../models"

type ViewLevel = "collapsed" | "expanded" | "show_all"

/** Format timestamp as "HH:MM AM/PM" for the expanded view metadata line */
function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  let h = d.getHours()
  const ampm = h >= 12 ? "PM" : "AM"
  h = h % 12 || 12
  const m = d.getMinutes().toString().padStart(2, "0")
  return `${h.toString().padStart(2, "0")}:${m} ${ampm}`
}

// ---------------------------------------------------------------------------
// Morphing asterisk spinner — matches native Claude Code style
// ---------------------------------------------------------------------------

const SPINNER_FRAMES = ['✱', '✳', '✴', '✵']
const SPINNER_INTERVAL_MS = 150

const THINKING_VERBS = [
  "Thinking",
  "Pondering",
  "Reasoning",
  "Shimmying",
  "Cogitating",
  "Musing",
  "Contemplating",
  "Noodling",
  "Mulling",
  "Ruminating",
]

/**
 * StreamingSpinner — morphing asterisk spinner with playful verbs.
 *
 * Matches native Claude Code's streaming indicator style:
 *   ✱ Shimmying... (5m 49s · ↓ 8.5k tokens)
 *
 * Shown in the conversation area while the agent is working
 * (RUNNING state, before text starts streaming). The label adapts
 * to the current activity: "Thinking..." by default, or
 * "Running [toolName]..." when a tool is executing.
 *
 * During the "Thinking..." phase, the verb cycles every 3 seconds
 * through whimsical synonyms to give visual feedback that the
 * model is actively working.
 */
function StreamingSpinner(props: { label: string; elapsedSeconds?: number; outputTokens?: number }) {
  const [frameIndex, setFrameIndex] = createSignal(0)
  const [verbIndex, setVerbIndex] = createSignal(0)

  const timer = setInterval(() => {
    setFrameIndex((i) => (i + 1) % SPINNER_FRAMES.length)
  }, SPINNER_INTERVAL_MS)

  // Cycle thinking verbs every 3 seconds (only when label is "Thinking...")
  const verbTimer = setInterval(() => {
    if (props.label === "Thinking...") {
      setVerbIndex((i) => (i + 1) % THINKING_VERBS.length)
    }
  }, 3000)

  onCleanup(() => {
    clearInterval(timer)
    clearInterval(verbTimer)
  })

  const displayLabel = () => {
    if (props.label === "Thinking...") {
      return THINKING_VERBS[verbIndex()] + "..."
    }
    return props.label
  }

  const timeStr = () => {
    const secs = props.elapsedSeconds ?? 0
    if (secs === 0) return ""
    if (secs < 60) return `${secs}s`
    const mins = Math.floor(secs / 60)
    const remSecs = secs % 60
    return `${mins}m ${remSecs}s`
  }

  const tokenStr = () => {
    const tokens = props.outputTokens ?? 0
    if (tokens === 0) return ""
    if (tokens >= 1000) return `\u2193 ${(tokens / 1000).toFixed(1)}k tokens`
    return `\u2193 ${tokens} tokens`
  }

  const metaStr = () => {
    const parts = [timeStr(), tokenStr()].filter(Boolean)
    return parts.length > 0 ? ` (${parts.join(" \u00B7 ")})` : ""
  }

  return (
    <box flexDirection="row">
      <text fg="#d78787">{SPINNER_FRAMES[frameIndex()]} </text>
      <text fg="#d78787">{displayLabel()}</text>
      <text fg="#a8a8a8">{metaStr()}</text>
    </box>
  )
}

// ---------------------------------------------------------------------------
// ToolBlockView — renders a single tool block
// ---------------------------------------------------------------------------

function ToolBlockView(props: { block: Extract<Block, { type: "tool" }>; viewLevel: ViewLevel }) {
  const b = () => props.block

  /** Primary arg for the tool invocation display: ToolName(arg) */
  const primaryArg = createMemo(() => {
    const inp = b().input as Record<string, unknown> | null
    if (!inp) return ""
    if (inp.file_path) return String(inp.file_path)
    if (inp.command) {
      const cmd = String(inp.command)
      return cmd.length > 80 ? cmd.slice(0, 77) + "..." : cmd
    }
    if (inp.pattern) {
      const p = String(inp.pattern)
      const path = inp.path ? ` in ${inp.path}` : ""
      const full = p + path
      return full.length > 80 ? full.slice(0, 77) + "..." : full
    }
    if (inp.description) {
      const d = String(inp.description)
      return d.length > 80 ? d.slice(0, 77) + "..." : d
    }
    return ""
  })

  /** Brief result summary for the ⎿ line */
  const resultSummary = createMemo(() => {
    if (b().status === "running") return ""
    if (b().error) return ""
    const out = b().output ?? ""
    if (!out) return ""

    // Generate summary based on tool type
    switch (b().tool) {
      case "Read": {
        const lines = out.split("\n").length
        return `Read ${lines} line${lines === 1 ? "" : "s"}`
      }
      case "Write":
        return `Wrote to ${primaryArg()}`
      case "Edit":
        return `Edited ${primaryArg()}`
      case "Bash": {
        // Show first line of output, truncated
        const firstLine = out.split("\n")[0] ?? ""
        return firstLine.length > 100 ? firstLine.slice(0, 97) + "..." : firstLine
      }
      case "Glob":
      case "Grep": {
        const lines = out.trim().split("\n").filter(l => l.trim()).length
        return `${lines} result${lines === 1 ? "" : "s"}`
      }
      default:
        return out.length > 100 ? out.slice(0, 97) + "..." : out.split("\n")[0] ?? ""
    }
  })

  return (
    <box flexDirection="column">
      {/* Invocation line: ⏺ ToolName(arg) */}
      <box flexDirection="row">
        <text fg="#d78787">{"\u23FA "}</text>
        <text fg="white">{b().tool}</text>
        <Show when={primaryArg()}>
          <text fg="gray">{"(" + primaryArg() + ")"}</text>
        </Show>
      </box>
      {/* Result line: ⎿  summary */}
      <Show when={props.viewLevel !== "collapsed" && resultSummary()}>
        <box paddingLeft={2}>
          <text fg="gray" attributes={TextAttributes.DIM}>
            {"\u23BF  " + resultSummary()}
          </text>
        </box>
      </Show>
      {/* Full output (show_all mode) */}
      <Show when={props.viewLevel === "show_all" && b().output}>
        <box paddingLeft={4}>
          <text fg="gray" attributes={TextAttributes.DIM}>
            {b().output}
          </text>
        </box>
      </Show>
      {/* Error line */}
      <Show when={b().error}>
        <box paddingLeft={2}>
          <text fg="red">
            {"\u23BF  " + (b().error!.split("\n")[0]!.length > 100 ? b().error!.split("\n")[0]!.slice(0, 97) + "..." : b().error!.split("\n")[0]!)}
          </text>
        </box>
      </Show>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Tool summary — collapsed view aggregation (matches Claude Code)
// ---------------------------------------------------------------------------

type ToolBlock = Extract<Block, { type: "tool" }>

/** Human-readable tool summary text */
function toolSummaryText(toolName: string, count: number): string {
  const s = count === 1 ? "" : "s"
  switch (toolName) {
    case "Read": return `Read ${count} file${s}`
    case "Edit": return `Edited ${count} file${s}`
    case "Write": return `Wrote ${count} file${s}`
    case "Bash": return `Ran ${count} command${s}`
    case "Glob": case "Grep": return `Searched ${count} pattern${s}`
    case "Agent": return `Spawned ${count} agent${s}`
    default: return `${toolName} (${count})`
  }
}

/** Collapsed tool summary view — "Running Bash..., Read 2 files (ctrl+o to expand)" */
function ToolSummaryView(props: { tools: ToolBlock[] }) {
  const summary = () => {
    const completed: Record<string, number> = {}
    const running: string[] = []
    let errorCount = 0

    for (const tool of props.tools) {
      if (tool.status === "running") {
        running.push(tool.tool)
      } else {
        completed[tool.tool] = (completed[tool.tool] || 0) + 1
        if (tool.error) errorCount++
      }
    }

    const parts: string[] = []
    // Running tools first
    for (const name of running) {
      parts.push(`Running ${name}...`)
    }
    // Then completed tools
    for (const [name, count] of Object.entries(completed)) {
      parts.push(toolSummaryText(name, count))
    }

    let text = parts.join(", ")
    if (errorCount > 0) {
      text += ` (${errorCount} error${errorCount > 1 ? "s" : ""})`
    }
    return text
  }

  return (
    <box paddingLeft={2} marginTop={1}>
      <text fg="#a8a8a8" attributes={TextAttributes.DIM}>
        {summary() + " (ctrl+o to expand)"}
      </text>
    </box>
  )
}

/** Render item: either a block or a tool summary */
type RenderItem =
  | { kind: "block"; block: Block }
  | { kind: "tool-summary"; tools: ToolBlock[] }

/** Group consecutive tool blocks into summaries when in collapsed view */
function groupBlocksForRendering(blocks: Block[], viewLevel: ViewLevel): RenderItem[] {
  if (viewLevel !== "collapsed") {
    return blocks.map(b => ({ kind: "block" as const, block: b }))
  }

  const items: RenderItem[] = []
  let toolGroup: ToolBlock[] = []

  for (const block of blocks) {
    if (block.type === "tool") {
      toolGroup.push(block as ToolBlock)
    } else {
      if (toolGroup.length > 0) {
        items.push({ kind: "tool-summary", tools: [...toolGroup] })
        toolGroup = []
      }
      items.push({ kind: "block", block })
    }
  }

  if (toolGroup.length > 0) {
    items.push({ kind: "tool-summary", tools: [...toolGroup] })
  }

  return items
}

// ---------------------------------------------------------------------------
// BlockView — dispatches rendering by block type
// ---------------------------------------------------------------------------

function BlockView(props: { block: Block; viewLevel: ViewLevel }) {
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
        <box flexDirection="row" marginTop={1} bg="#3a3a3a">
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
              <markdown content={ab().text} syntaxStyle={syntaxStyle} />
            </box>
          </box>
        </box>
      }</Show>

      {/* Thinking block — hidden in collapsed view (matches Claude Code) */}
      <Show when={props.viewLevel !== "collapsed" && thinkingBlock()}>{(tb) =>
        <ThinkingBlock text={tb().text} collapsed={props.viewLevel === "expanded"} />
      }</Show>

      {/* Tool block */}
      <Show when={toolBlock()}>{(tb) =>
        <ToolBlockView block={tb()} viewLevel={props.viewLevel} />
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

// ---------------------------------------------------------------------------
// ConversationView — main export
// ---------------------------------------------------------------------------

export function ConversationView(props: { children?: JSX.Element }) {
  const { state } = useMessages()
  const { state: session } = useSession()
  const [viewLevel, setViewLevel] = createSignal<ViewLevel>("collapsed")
  const [viewLevelHint, setViewLevelHint] = createSignal<string | null>(null)
  let viewLevelHintTimer: ReturnType<typeof setTimeout> | undefined
  let scrollboxRef: ScrollBoxRenderable | undefined

  // Derived: separate queued vs non-queued blocks, group tools for rendering
  const nonQueuedBlocks = () => state.blocks.filter(b => !(b.type === "user" && b.queued))
  const queuedBlocks = () => state.blocks.filter(b => b.type === "user" && b.queued) as Array<Extract<Block, { type: "user" }>>
  const renderItems = () => groupBlocksForRendering(nonQueuedBlocks(), viewLevel())

  // -- Turn elapsed time for the spinner --
  const [turnStartTime, setTurnStartTime] = createSignal<number | null>(null)
  const [turnElapsed, setTurnElapsed] = createSignal(0)
  let prevSessionState: string = session.sessionState

  const turnTickHandle = setInterval(() => {
    const currentState = session.sessionState
    // Detect transition into RUNNING
    if (currentState === "RUNNING" && prevSessionState !== "RUNNING") {
      setTurnStartTime(Date.now())
      setTurnElapsed(0)
    }
    // Detect transition out of RUNNING
    if (currentState !== "RUNNING" && prevSessionState === "RUNNING") {
      setTurnStartTime(null)
      setTurnElapsed(0)
    }
    prevSessionState = currentState
    // Update elapsed while running
    if (currentState === "RUNNING") {
      const start = turnStartTime()
      if (start !== null) {
        setTurnElapsed(Math.floor((Date.now() - start) / 1000))
      }
    }
  }, 1000)

  onCleanup(() => clearInterval(turnTickHandle))

  // Spinner label from running tools in blocks
  const spinnerLabel = () => {
    const blocks = state.blocks
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i]
      if (b.type === "tool" && b.status === "running") {
        return `Running ${b.tool}...`
      }
    }
    return "Thinking..."
  }

  // Periodic stickyScroll re-engagement during streaming
  // Uses a 200ms interval (not per-delta) to avoid scroll thrashing
  // that was fixed in commit 91901ca
  let scrollNudgeTimer: ReturnType<typeof setInterval> | undefined
  createEffect(() => {
    const isStreaming = !!(state.streamingText || state.streamingThinking)
    if (isStreaming) {
      if (!scrollNudgeTimer) {
        // Initial nudge
        scrollboxRef?.scrollBy(1, "content")
        // Periodic nudge every 200ms
        scrollNudgeTimer = setInterval(() => {
          scrollboxRef?.scrollBy(1, "content")
        }, 200)
      }
    } else {
      if (scrollNudgeTimer) {
        clearInterval(scrollNudgeTimer)
        scrollNudgeTimer = undefined
      }
    }
  })
  onCleanup(() => {
    if (scrollNudgeTimer) {
      clearInterval(scrollNudgeTimer)
    }
  })

  // View-level notification helper — transient hint, not a permanent message
  const showViewLevelHint = (level: ViewLevel) => {
    const text = level === "collapsed"
      ? "Showing collapsed view · ctrl+o to expand · ctrl+e to show all"
      : level === "expanded"
      ? "Showing detailed transcript · ctrl+o to toggle · ctrl+e to show all"
      : "Showing detailed transcript · ctrl+o to toggle · ctrl+e to collapse"
    setViewLevelHint(text)
    clearTimeout(viewLevelHintTimer)
    viewLevelHintTimer = setTimeout(() => setViewLevelHint(null), 3000)
  }
  onCleanup(() => clearTimeout(viewLevelHintTimer))

  // Ctrl+O toggles collapsed/expanded, Ctrl+E shows all
  // Ctrl+Up/Down scrolls the conversation
  useKeyboard((event) => {
    if (event.ctrl && event.name === "o") {
      const next: ViewLevel = viewLevel() === "collapsed" ? "expanded" : "collapsed"
      setViewLevel(next)
      showViewLevelHint(next)
    }
    if (event.ctrl && event.name === "e") {
      const next: ViewLevel = viewLevel() === "show_all" ? "collapsed" : "show_all"
      setViewLevel(next)
      showViewLevelHint(next)
    }
    if (event.ctrl && event.name === "up") {
      scrollboxRef?.scrollBy(-3)
      showScrollbarBriefly()
    }
    if (event.ctrl && event.name === "down") {
      scrollboxRef?.scrollBy(3)
      showScrollbarBriefly()
    }
  })

  // Auto-hide scrollbar: show on scroll, hide after 1s idle (matches Claude Code)
  let scrollbarTimer: ReturnType<typeof setTimeout> | undefined
  const showScrollbarBriefly = () => {
    if (scrollboxRef) {
      scrollboxRef.verticalScrollBar.visible = true
      clearTimeout(scrollbarTimer)
      scrollbarTimer = setTimeout(() => {
        if (scrollboxRef) scrollboxRef.verticalScrollBar.visible = false
      }, 1000)
    }
  }
  createEffect(() => {
    if (scrollboxRef) {
      scrollboxRef.verticalScrollBar.visible = false
    }
  })
  onCleanup(() => clearTimeout(scrollbarTimer))

  return (
    <scrollbox ref={scrollboxRef} stickyScroll flexGrow={1}>
      <box flexDirection="column" padding={1}>
        {/* Header bar — scrolls with content */}
        <HeaderBar />

        {/*
          IMPORTANT: Every dynamic section (<For>, <Show>) is wrapped in a
          stable <box> so the parent layout always has a fixed set of children.
          Without wrappers, SolidJS's reactive primitives dynamically
          insert/remove direct children and OpenTUI's Zig layout engine can
          place them at the wrong position (e.g., streaming text above committed
          blocks instead of below).
        */}

        {/* Committed blocks (non-queued) — tool blocks grouped in collapsed view */}
        <box flexDirection="column">
          <For each={renderItems()}>
            {(item) =>
              item.kind === "tool-summary"
                ? <ToolSummaryView tools={item.tools} />
                : <BlockView block={item.block} viewLevel={viewLevel()} />
            }
          </For>
        </box>

        {/* Streaming thinking (transient) — hidden in collapsed view, spinner shows instead */}
        <box flexDirection="column">
          <Show when={state.streamingThinking && viewLevel() !== "collapsed"}>
            <ThinkingBlock text={state.streamingThinking} collapsed={viewLevel() === "expanded"} />
          </Show>
        </box>

        {/* Streaming text (transient) — styled as assistant with prefix.
            Uses visible={false} instead of <Show> to avoid destroying/recreating
            the <markdown> component at flush boundaries (tool_use_start,
            text_complete, turn_complete). Destroying forces all internal
            CodeRenderable sub-blocks to re-highlight from scratch, leaving
            text invisible for 1+ frames while async tree-sitter completes. */}
        <box flexDirection="column">
          <box flexDirection="row" marginTop={state.streamingText ? 1 : 0} visible={!!state.streamingText}>
            <box width={2} flexShrink={0}>
              <text fg="white">{"\u23FA"}</text>
            </box>
            <box flexGrow={1}>
              <markdown content={state.streamingText} syntaxStyle={syntaxStyle} streaming={true} />
            </box>
          </box>
        </box>

        {/* Queued user messages (muted, after streaming) */}
        <box flexDirection="column">
          <For each={queuedBlocks()}>
            {(block) => (
              <box flexDirection="row" paddingLeft={2} marginTop={1}>
                <text fg="#808080" attributes={TextAttributes.DIM}>
                  {"> " + block.text + " (queued)"}
                </text>
              </box>
            )}
          </For>
        </box>

        {/* Transient view-level hint — replaces itself, auto-clears after 3s */}
        <box flexDirection="column">
          <Show when={viewLevelHint()}>
            <text fg="#808080" attributes={TextAttributes.DIM}>{viewLevelHint()}</text>
          </Show>
        </box>

        {/* Spinner — visible when RUNNING but no streaming content */}
        <box flexDirection="column">
          <Show when={
            session.sessionState === "RUNNING" &&
            !state.streamingText &&
            !state.streamingThinking
          }>
            <StreamingSpinner label={spinnerLabel()} elapsedSeconds={turnElapsed()} outputTokens={session.cost.outputTokens} />
          </Show>
        </box>

        {/* Background tasks / subagents */}
        <box flexDirection="column">
          <Show when={state.activeTasks.length > 0}>
            <TaskView tasks={state.activeTasks} />
          </Show>
        </box>

        {/* Error display */}
        <box flexDirection="column">
          <Show when={session.sessionState === "ERROR" && session.lastError}>
            <box
              flexDirection="column"
              paddingTop={1}
              paddingBottom={1}
              paddingLeft={2}
              paddingRight={2}
              borderStyle="single"
              borderColor="red"
            >
              <text fg="red" attributes={TextAttributes.BOLD}>
                Error: {session.lastError!.code}
              </text>
              <text fg="red">{session.lastError!.message}</text>
            </box>
          </Show>
        </box>
      </box>

      {/* Input area, status bar, dialogs — rendered inside scrollbox so they flow with content */}
      {props.children}
    </scrollbox>
  )
}
