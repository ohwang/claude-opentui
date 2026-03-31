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
import { refocusInput } from "./input-area"

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
  // -- From native Claude Code (56 verbs) --
  "Accomplishing", "Actioning", "Actualizing", "Baking", "Brewing",
  "Calculating", "Cerebrating", "Churning", "Clauding", "Coalescing",
  "Cogitating", "Computing", "Conjuring", "Considering", "Cooking",
  "Crafting", "Creating", "Crunching", "Deliberating", "Determining",
  "Doing", "Effecting", "Finagling", "Forging", "Forming",
  "Generating", "Hatching", "Herding", "Honking", "Hustling",
  "Ideating", "Inferring", "Manifesting", "Marinating", "Moseying",
  "Mulling", "Mustering", "Musing", "Noodling", "Percolating",
  "Pondering", "Processing", "Puttering", "Reticulating", "Ruminating",
  "Schlepping", "Shucking", "Simmering", "Smooshing", "Spinning",
  "Stewing", "Synthesizing", "Thinking", "Transmuting", "Vibing",
  "Working",
  // -- Whimsical extras (100 verbs) --
  "Analyzing", "Assembling", "Booping", "Brainstorming", "Bubbling",
  "Calibrating", "Channeling", "Combobulating", "Compiling", "Contemplating",
  "Composing", "Conceiving", "Concocting", "Contriving", "Daydreaming",
  "Deciphering", "Decoding", "Deducing", "Defenestrating", "Devising",
  "Digesting", "Discombobulating", "Distilling", "Dreaming", "Elaborating",
  "Elucidating", "Envisioning", "Evaluating", "Extrapolating", "Fermenting",
  "Figuring", "Flibbertigibbeting", "Formulating", "Fussing", "Gestating",
  "Grooving", "Grokking", "Hypothesizing", "Imagining", "Improvising",
  "Incubating", "Interpolating", "Intuiting", "Inventing", "Iterating",
  "Jigsawing", "Juggling", "Kibbitzing", "Kneading", "Machinating",
  "Meditating", "Metabolizing", "Minding", "Navigating", "Noodging",
  "Orchestrating", "Perambulating", "Philosophizing", "Pickling",
  "Plotting", "Plumbing", "Prognosticating", "Puzzling", "Ratiocinating",
  "Reasoning", "Recombobulating", "Reckoning", "Reflecting", "Scheming",
  "Scoping", "Sculpting", "Shimmying", "Sifting", "Simulating",
  "Sleuthing", "Spit-balling", "Steeping", "Strategizing", "Tinkering",
  "Toiling", "Triangulating", "Unraveling", "Untangling", "Vectoring",
  "Waffling", "Weighing", "Whittling", "Wibbling", "Wrangling",
  "Yearning", "Yodeling", "Zigzagging", "Zooming",
  "Braising", "Cajoling", "Doodling", "Excavating", "Fathoming",
  "Galvanizing", "Harmonizing",
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
  const [verbIndex, setVerbIndex] = createSignal(Math.floor(Math.random() * THINKING_VERBS.length))

  const timer = setInterval(() => {
    setFrameIndex((i) => (i + 1) % SPINNER_FRAMES.length)
  }, SPINNER_INTERVAL_MS)

  // Cycle thinking verbs every 3 seconds (only when label is "Thinking...")
  // Random selection avoids the predictable sequential feel; re-roll to
  // prevent showing the same verb twice in a row.
  const verbTimer = setInterval(() => {
    if (props.label === "Thinking...") {
      setVerbIndex((prev) => {
        let next = Math.floor(Math.random() * THINKING_VERBS.length)
        while (next === prev) {
          next = Math.floor(Math.random() * THINKING_VERBS.length)
        }
        return next
      })
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

/** Threshold in seconds before showing elapsed time on running tools */
const TOOL_ELAPSED_SHOW_THRESHOLD = 5
/** Threshold in seconds before showing a warning on long-running tools */
const TOOL_LONG_RUNNING_THRESHOLD = 30
/** Threshold in seconds before showing a critical warning */
const TOOL_CRITICAL_THRESHOLD = 300 // 5 minutes

function ToolBlockView(props: { block: Extract<Block, { type: "tool" }>; viewLevel: ViewLevel }) {
  const b = () => props.block

  // Elapsed time signal for running tools — updates every second
  const [elapsed, setElapsed] = createSignal(0)
  let elapsedTimer: ReturnType<typeof setInterval> | undefined

  createEffect(() => {
    if (b().status === "running") {
      // Start ticking
      setElapsed(Math.floor((Date.now() - b().startTime) / 1000))
      elapsedTimer = setInterval(() => {
        setElapsed(Math.floor((Date.now() - b().startTime) / 1000))
      }, 1000)
    } else {
      // Tool finished — clear timer
      if (elapsedTimer) {
        clearInterval(elapsedTimer)
        elapsedTimer = undefined
      }
    }
  })
  onCleanup(() => {
    if (elapsedTimer) clearInterval(elapsedTimer)
  })

  /** Format elapsed seconds as compact string */
  const elapsedStr = () => {
    const secs = elapsed()
    if (secs < TOOL_ELAPSED_SHOW_THRESHOLD) return ""
    if (secs < 60) return `${secs}s`
    const mins = Math.floor(secs / 60)
    const remSecs = secs % 60
    return `${mins}m ${remSecs}s`
  }

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
        {/* Elapsed time for running tools */}
        <Show when={b().status === "running" && elapsedStr()}>
          <text fg={elapsed() >= TOOL_CRITICAL_THRESHOLD ? "#ff5f5f" : elapsed() >= TOOL_LONG_RUNNING_THRESHOLD ? "#d7af5f" : "#808080"}>
            {" " + elapsedStr()}
          </text>
        </Show>
        {/* Duration for completed tools (expanded/show_all views) */}
        <Show when={b().status !== "running" && props.viewLevel !== "collapsed" && b().duration !== undefined && b().duration! >= 1000}>
          <text fg="#808080" attributes={TextAttributes.DIM}>
            {" " + (b().duration! < 60000 ? `${Math.round(b().duration! / 1000)}s` : `${Math.floor(b().duration! / 60000)}m ${Math.round((b().duration! % 60000) / 1000)}s`)}
          </text>
        </Show>
      </box>
      {/* Long-running warning */}
      <Show when={b().status === "running" && elapsed() >= TOOL_LONG_RUNNING_THRESHOLD}>
        <box paddingLeft={2}>
          <text fg={elapsed() >= TOOL_CRITICAL_THRESHOLD ? "#ff5f5f" : "#d7af5f"} attributes={TextAttributes.DIM}>
            {elapsed() >= TOOL_CRITICAL_THRESHOLD
              ? "\u23BF  Tool may be stuck. Press Ctrl+C to interrupt."
              : "\u23BF  Still running..."}
          </text>
        </box>
      </Show>
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
        if (tool.status === "error" || tool.error) errorCount++
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

  const hasErrors = () => props.tools.some(t => t.status === "error" || t.error)

  return (
    <box paddingLeft={2} marginTop={1}>
      <text fg={hasErrors() ? "#ff5f5f" : "#a8a8a8"} attributes={TextAttributes.DIM}>
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

function BlockView(props: { block: Block; viewLevel: ViewLevel; prevType?: string; showThinking?: boolean }) {
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

      {/* Thinking block — hidden in collapsed view or when thinking toggle is off */}
      <Show when={props.showThinking !== false && props.viewLevel !== "collapsed" && thinkingBlock()}>{(tb) =>
        <box marginTop={1}>
          <ThinkingBlock text={tb().text} collapsed={props.viewLevel === "expanded"} />
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

// ---------------------------------------------------------------------------
// ConversationView — main export
// ---------------------------------------------------------------------------

export function ConversationView(props: { children?: JSX.Element }) {
  const { state } = useMessages()
  const { state: session } = useSession()
  const [viewLevel, setViewLevel] = createSignal<ViewLevel>("collapsed")
  const [showThinking, setShowThinking] = createSignal(true)
  const [viewLevelHint, setViewLevelHint] = createSignal<string | null>(null)
  let viewLevelHintTimer: ReturnType<typeof setTimeout> | undefined
  let scrollboxRef: ScrollBoxRenderable | undefined
  const [userScrolledAway, setUserScrolledAway] = createSignal(false)

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
        setUserScrolledAway(false)
        // Initial nudge
        if (!userScrolledAway()) {
          scrollboxRef?.scrollBy(1, "content")
        }
        // Periodic nudge every 200ms — only when user hasn't scrolled away
        scrollNudgeTimer = setInterval(() => {
          if (!userScrolledAway()) {
            scrollboxRef?.scrollBy(1, "content")
          }
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

  // Auto-scroll to bottom when permission/elicitation dialog appears
  // so the user can see and interact with it immediately
  createEffect(() => {
    const state = session.sessionState
    if (state === "WAITING_FOR_PERM" || state === "WAITING_FOR_ELIC") {
      scrollboxRef?.scrollBy(999999)
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

  // Ctrl+O toggles collapsed/expanded, Ctrl+E shows all, Ctrl+T toggles thinking
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
    if (event.ctrl && event.name === "t") {
      const next = !showThinking()
      setShowThinking(next)
      const text = next ? "Thinking: visible" : "Thinking: hidden"
      setViewLevelHint(text)
      clearTimeout(viewLevelHintTimer)
      viewLevelHintTimer = setTimeout(() => setViewLevelHint(null), 2000)
    }
    if (event.ctrl && event.name === "up") {
      scrollboxRef?.scrollBy(-3)
      setUserScrolledAway(true)
      showScrollbarBriefly()
      refocusInput()
    }
    if (event.ctrl && event.name === "down") {
      scrollboxRef?.scrollBy(3)
      setUserScrolledAway(false)
      showScrollbarBriefly()
      refocusInput()
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
      <box flexDirection="column" paddingTop={1} paddingRight={1} paddingBottom={1}>
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
            {(item, index) => {
              const items = renderItems()
              const prev = index() > 0 ? items[index() - 1] : undefined
              const prevType = prev
                ? prev.kind === "tool-summary" ? "tool-summary" : prev.block.type
                : undefined

              return item.kind === "tool-summary"
                ? <ToolSummaryView tools={item.tools} />
                : <BlockView block={item.block} viewLevel={viewLevel()} prevType={prevType} showThinking={showThinking()} />
            }}
          </For>
        </box>

        {/* Streaming thinking (transient) — hidden in collapsed view, when thinking toggle is off, spinner shows instead */}
        <box flexDirection="column">
          <Show when={showThinking() && state.streamingThinking && viewLevel() !== "collapsed"}>
            <box marginTop={1}>
              <ThinkingBlock text={state.streamingThinking} collapsed={viewLevel() === "expanded"} />
            </box>
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
