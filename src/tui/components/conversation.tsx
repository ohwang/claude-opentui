/**
 * Conversation View — Scrollbox with sticky scroll
 *
 * Renders all blocks, streaming content, active tools.
 * Uses OpenTUI stickyScroll for auto-following.
 * Ctrl+O toggles tool view level, Ctrl+E shows all.
 */

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

type ViewLevel = "collapsed" | "expanded" | "show_all"

// ---------------------------------------------------------------------------
// Braille spinner — animated activity indicator
// ---------------------------------------------------------------------------

const SPINNER_FRAMES = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"]
const SPINNER_INTERVAL_MS = 80

/**
 * StreamingSpinner — braille dot spinner with contextual verb.
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
      <text fg="gray" attributes={TextAttributes.DIM}>
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
  const statusIcon = () => {
    switch (b().status) {
      case "running": return "\u23FA"
      case "done": return "\u2713"
      case "error": return "\u2717"
      case "canceled": return "\u2298"
      default: return "\u23FA"
    }
  }
  const statusColor = () => {
    switch (b().status) {
      case "running": return "#d78787"
      case "done": return "green"
      case "error": return "red"
      case "canceled": return "gray"
      default: return "gray"
    }
  }
  const duration = () => {
    if (!b().duration) return ""
    return b().duration! < 1000 ? `${b().duration}ms` : `${(b().duration! / 1000).toFixed(1)}s`
  }
  const toolSummary = createMemo(() => {
    const inp = b().input as Record<string, unknown> | null
    if (!inp) return ""

    // Common tool input patterns
    if (inp.file_path) return String(inp.file_path)
    if (inp.command) {
      const cmd = String(inp.command)
      return cmd.length > 60 ? cmd.slice(0, 57) + "..." : cmd
    }
    if (inp.pattern) {
      const p = String(inp.pattern)
      const path = inp.path ? ` in ${inp.path}` : ""
      const full = p + path
      return full.length > 60 ? full.slice(0, 57) + "..." : full
    }
    if (inp.description) {
      const d = String(inp.description)
      return d.length > 60 ? d.slice(0, 57) + "..." : d
    }

    return ""
  })

  return (
    <box flexDirection="column" paddingLeft={2}>
      <box flexDirection="row">
        <text fg={statusColor()}>{statusIcon()} </text>
        <text fg="white" attributes={TextAttributes.BOLD}>{b().tool}</text>
        <Show when={toolSummary()}>
          <text fg="gray" attributes={TextAttributes.DIM}>{" " + toolSummary()}</text>
        </Show>
        <Show when={duration()}>
          <text fg="gray" attributes={TextAttributes.DIM}>{" (" + duration() + ")"}</text>
        </Show>
      </box>
      <Show when={props.viewLevel !== "collapsed" && b().output}>
        <box paddingLeft={4}>
          <text fg="gray" attributes={TextAttributes.DIM}>
            {(b().output ?? "").slice(0, props.viewLevel === "show_all" ? undefined : 200)}
          </text>
        </box>
      </Show>
      <Show when={b().error}>
        <box paddingLeft={4}>
          <text fg="red">{b().error}</text>
        </box>
      </Show>
    </box>
  )
}

// ---------------------------------------------------------------------------
// BlockView — dispatches rendering by block type
// ---------------------------------------------------------------------------

function BlockView(props: { block: Block; viewLevel: ViewLevel }) {
  const b = () => props.block

  return (
    <box flexDirection="column">
      {/* User block */}
      <Show when={b().type === "user"}>
        <box flexDirection="row" marginTop={1}>
          <text fg="gray" attributes={TextAttributes.DIM}>{"> "}</text>
          <text fg="white">{(b() as any).text}</text>
        </box>
      </Show>

      {/* Assistant text block */}
      <Show when={b().type === "assistant"}>
        <box flexDirection="row" marginTop={1}>
          <text fg="white">{"\u23FA "}</text>
          <box flexGrow={1}>
            <markdown content={(b() as any).text} syntaxStyle={syntaxStyle} />
          </box>
        </box>
      </Show>

      {/* Thinking block */}
      <Show when={b().type === "thinking"}>
        <ThinkingBlock text={(b() as any).text} collapsed={props.viewLevel === "collapsed"} />
      </Show>

      {/* Tool block */}
      <Show when={b().type === "tool"}>
        <ToolBlockView block={b() as Extract<Block, { type: "tool" }>} viewLevel={props.viewLevel} />
      </Show>

      {/* System block */}
      <Show when={b().type === "system"}>
        <box paddingLeft={2} marginTop={1}>
          <text fg="gray" attributes={TextAttributes.DIM | TextAttributes.ITALIC}>
            {"\u2139 " + (b() as any).text}
          </text>
        </box>
      </Show>

      {/* Compact block */}
      <Show when={b().type === "compact"}>
        <box paddingTop={1} paddingBottom={1}>
          <text fg="gray" attributes={TextAttributes.DIM}>
            {"\u2500\u2500 Context compacted \u2500\u2500"}
          </text>
        </box>
      </Show>

      {/* Error block */}
      <Show when={b().type === "error"}>
        <box flexDirection="column" paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} borderStyle="single" borderColor="red">
          <text fg="red" attributes={TextAttributes.BOLD}>Error: {(b() as any).code}</text>
          <text fg="red">{(b() as any).message}</text>
        </box>
      </Show>
    </box>
  )
}

// ---------------------------------------------------------------------------
// ConversationView — main export
// ---------------------------------------------------------------------------

export function ConversationView() {
  const { state } = useMessages()
  const { state: session } = useSession()
  const [viewLevel, setViewLevel] = createSignal<ViewLevel>("collapsed")
  let scrollboxRef: ScrollBoxRenderable | undefined

  // Derived: separate queued vs non-queued blocks
  const nonQueuedBlocks = () => state.blocks.filter(b => !(b.type === "user" && b.queued))
  const queuedBlocks = () => state.blocks.filter(b => b.type === "user" && b.queued) as Array<Extract<Block, { type: "user" }>>

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

  // Ctrl+O toggles collapsed/expanded, Ctrl+E shows all
  // Ctrl+Up/Down scrolls the conversation
  useKeyboard((event) => {
    if (event.ctrl && event.name === "o") {
      setViewLevel((prev) => prev === "collapsed" ? "expanded" : "collapsed")
    }
    if (event.ctrl && event.name === "e") {
      setViewLevel((prev) => prev === "show_all" ? "collapsed" : "show_all")
    }
    if (event.ctrl && event.name === "up") {
      scrollboxRef?.scrollBy(-3)
    }
    if (event.ctrl && event.name === "down") {
      scrollboxRef?.scrollBy(3)
    }
  })

  return (
    <scrollbox ref={scrollboxRef} stickyScroll stickyStart="bottom" flexGrow={1}>
      <box flexDirection="column" padding={1}>
        {/* Header bar — scrolls with content */}
        <HeaderBar />

        {/* Committed blocks (non-queued) */}
        <For each={nonQueuedBlocks()}>
          {(block) => <BlockView block={block} viewLevel={viewLevel()} />}
        </For>

        {/* Streaming thinking (transient) */}
        <Show when={state.streamingThinking}>
          <ThinkingBlock text={state.streamingThinking} collapsed={false} />
        </Show>

        {/* Streaming text (transient) — styled as assistant with prefix */}
        <Show when={state.streamingText}>
          <box flexDirection="row" marginTop={1}>
            <text fg="white">{"\u23FA "}</text>
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
    </scrollbox>
  )
}
