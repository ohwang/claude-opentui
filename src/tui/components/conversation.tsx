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
import { useSync } from "../context/sync"
import { ThinkingBlock } from "./thinking-block"
import { TaskView } from "./task-view"
import { syntaxStyle } from "../theme"
import { HeaderBar } from "./header-bar"
import type { Block } from "../../protocol/types"

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
// Breathing asterisk spinner — animated activity indicator
// ---------------------------------------------------------------------------

const SPINNER_FRAMES = ['·', '⁺', '✦', '✶', '✻', '✽', '✻', '✶', '✦', '⁺']
const SPINNER_INTERVAL_MS = 120

/**
 * StreamingSpinner — breathing asterisk spinner with contextual verb.
 *
 * Shown in the conversation area while the agent is working
 * (RUNNING state, before text starts streaming). The label adapts
 * to the current activity: "Thinking..." by default, or
 * "Running [toolName]..." when a tool is executing.
 */
function StreamingSpinner(props: { label: string }) {
  const [frameIndex, setFrameIndex] = createSignal(0)

  const timer = setInterval(() => {
    setFrameIndex((i) => (i + 1) % SPINNER_FRAMES.length)
  }, SPINNER_INTERVAL_MS)

  onCleanup(() => clearInterval(timer))

  return (
    <box flexDirection="row">
      <text fg="#a8a8a8">
        {SPINNER_FRAMES[frameIndex()]} {props.label}
      </text>
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

/** Collapsed tool summary view — "Read 2 files, ran 1 command (ctrl+o to expand)" */
function ToolSummaryView(props: { tools: ToolBlock[] }) {
  const summary = () => {
    const counts: Record<string, number> = {}
    for (const tool of props.tools) {
      counts[tool.tool] = (counts[tool.tool] || 0) + 1
    }
    const parts: string[] = []
    for (const [name, count] of Object.entries(counts)) {
      parts.push(toolSummaryText(name, count))
    }
    return parts.join(", ")
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
        <box flexDirection="row" marginTop={1}>
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
                {formatTimestamp(ab().timestamp!) + (ab().model ? " " + ab().model : "")}
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
      <Show when={thinkingBlock() && props.viewLevel !== "collapsed"}>{(tb) =>
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
  const sync = useSync()
  const [viewLevel, setViewLevel] = createSignal<ViewLevel>("collapsed")
  let scrollboxRef: ScrollBoxRenderable | undefined

  // Derived: separate queued vs non-queued blocks, group tools for rendering
  const nonQueuedBlocks = () => state.blocks.filter(b => !(b.type === "user" && b.queued))
  const queuedBlocks = () => state.blocks.filter(b => b.type === "user" && b.queued) as Array<Extract<Block, { type: "user" }>>
  const renderItems = () => groupBlocksForRendering(nonQueuedBlocks(), viewLevel())

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

  // Re-engage stickyScroll when new blocks arrive
  let prevBlockCount = 0
  createEffect(() => {
    const count = state.blocks.length
    if (count > prevBlockCount) {
      scrollboxRef?.scrollBy(1, "content")
    }
    prevBlockCount = count
  })

  // Also re-engage on streaming text changes
  createEffect(() => {
    if (state.streamingText || state.streamingThinking) {
      scrollboxRef?.scrollBy(1, "content")
    }
  })

  // View-level notification helper
  const viewLevelHint = (level: ViewLevel): string => {
    switch (level) {
      case "collapsed":
        return "Showing collapsed view · ctrl+o to expand · ctrl+e to show all"
      case "expanded":
        return "Showing detailed transcript · ctrl+o to toggle · ctrl+e to show all"
      case "show_all":
        return "Showing detailed transcript · ctrl+o to toggle · ctrl+e to collapse"
    }
  }

  // Ctrl+O toggles collapsed/expanded, Ctrl+E shows all
  // Ctrl+Up/Down scrolls the conversation
  useKeyboard((event) => {
    if (event.ctrl && event.name === "o") {
      const next: ViewLevel = viewLevel() === "collapsed" ? "expanded" : "collapsed"
      setViewLevel(next)
      sync.pushEvent({ type: "system_message", text: viewLevelHint(next) })
    }
    if (event.ctrl && event.name === "e") {
      const next: ViewLevel = viewLevel() === "show_all" ? "collapsed" : "show_all"
      setViewLevel(next)
      sync.pushEvent({ type: "system_message", text: viewLevelHint(next) })
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

        {/* Committed blocks (non-queued) — tool blocks grouped in collapsed view */}
        <For each={renderItems()}>
          {(item) =>
            item.kind === "tool-summary"
              ? <ToolSummaryView tools={item.tools} />
              : <BlockView block={item.block} viewLevel={viewLevel()} />
          }
        </For>

        {/* Streaming thinking (transient) — hidden in collapsed view, spinner shows instead */}
        <Show when={state.streamingThinking && viewLevel() !== "collapsed"}>
          <ThinkingBlock text={state.streamingThinking} collapsed={viewLevel() === "expanded"} />
        </Show>

        {/* Streaming text (transient) — styled as assistant with prefix */}
        <Show when={state.streamingText}>
          <box flexDirection="row" marginTop={1}>
            <box width={2} flexShrink={0}>
              <text fg="white">{"\u23FA"}</text>
            </box>
            <box flexGrow={1}>
              <markdown content={state.streamingText} syntaxStyle={syntaxStyle} streaming={true} />
            </box>
          </box>
        </Show>

        {/* Queued user messages (muted, after streaming) */}
        <For each={queuedBlocks()}>
          {(block) => (
            <box flexDirection="row" paddingLeft={2} marginTop={1}>
              <text fg="#808080" attributes={TextAttributes.DIM}>
                {"> " + block.text + " (queued)"}
              </text>
            </box>
          )}
        </For>

        {/* Spinner — visible when RUNNING but no streaming content */}
        <Show when={
          session.sessionState === "RUNNING" &&
          !state.streamingText &&
          !state.streamingThinking
        }>
          <StreamingSpinner label={spinnerLabel()} />
        </Show>

        {/* Background tasks / subagents */}
        <Show when={state.activeTasks.length > 0}>
          <TaskView tasks={state.activeTasks} />
        </Show>

        {/* Error display */}
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

      {/* Input area, status bar, dialogs — rendered inside scrollbox so they flow with content */}
      {props.children}
    </scrollbox>
  )
}
