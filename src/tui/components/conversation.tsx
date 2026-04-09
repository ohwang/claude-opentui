/**
 * Conversation View — Single scrollbox containing all content
 *
 * Everything (blocks, streaming content, input area, status bar) lives
 * inside one scrollbox. When scrolled up, the entire UI — including the
 * input area and status bar — scrolls off-screen, matching Claude Code.
 * A flex spacer + minHeight="100%" keeps the footer pinned to the bottom
 * of the viewport when conversation content is short.
 *
 * Auto-scrolls using OpenTUI's native stickyScroll={true} + stickyStart="bottom".
 * The Zig layout engine pins the viewport to the bottom during its own render
 * frame — no timers or timing hacks needed for streaming, resume, or content
 * changes. When the user scrolls away (Ctrl+Up or mouse wheel), stickyScroll
 * is disabled so the viewport stays in place. Re-enables on Ctrl+Down back to
 * bottom, printable input, or sending a new message.
 * Ctrl+O toggles tool view level, Ctrl+E shows all.
 */

import type { JSX } from "solid-js"
import { createSignal, createEffect, createMemo, onCleanup, Show, For, Index, batch } from "solid-js"
import { type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useMessages } from "../context/messages"
import { useSession } from "../context/session"
import { ThinkingBlock } from "./thinking-block"
import { TaskView } from "./task-view"
import { syntaxStyle } from "../theme"
import { colors } from "../theme/tokens"
import { HeaderBar } from "./header-bar"
import type { Block } from "../../protocol/types"
import { hideCursor, showCursor, registerScrollToBottom } from "./input-area"
import { StreamingSpinner } from "./streaming-spinner"
import { type ViewLevel } from "./tool-view"
import { isMcpTool, parseMcpToolName } from "./mcp-tool-view"
import { BlockView } from "./block-view"
import { CollapsedToolGroup } from "./collapsed-tool-group"
import { EphemeralLine } from "./ephemeral-line"
import { ToastDisplay } from "./toast"
import { groupConsecutiveTools, isToolGroup, type GroupedItem, type ToolGroup } from "../utils/tool-grouping"
import { TurnSummary } from "./turn-summary"
import { QueuedMessage } from "./blocks/queued-message"
import { createThrottledValue } from "../../utils/throttled-value"

export type { ViewLevel }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check whether a scrollbox is at or near the bottom of its content */
function isNearBottom(ref: ScrollBoxRenderable, threshold = 3): boolean {
  const viewportHeight = ref.viewport.height
  return ref.scrollTop + viewportHeight >= ref.scrollHeight - threshold
}

// ---------------------------------------------------------------------------
// ConversationView — main export
// ---------------------------------------------------------------------------

export function ConversationView(props: { children?: JSX.Element; footerHint?: string | null }) {
  const { state } = useMessages()
  const { state: session } = useSession()
  const [viewLevel, setViewLevel] = createSignal<ViewLevel>("collapsed")
  const [showThinking, setShowThinking] = createSignal(true)
  const [viewLevelHint, setViewLevelHint] = createSignal<string | null>(null)
  let viewLevelHintTimer: ReturnType<typeof setTimeout> | undefined
  let scrollboxRef: ScrollBoxRenderable | undefined
  const [userScrolledAway, setUserScrolledAway] = createSignal(false)

  // Helper: sync userScrolledAway and cursor visibility.
  // stickyScroll is reactively bound in JSX via !userScrolledAway().
  const setScrolledAway = (away: boolean) => {
    setUserScrolledAway(away)
    if (away) hideCursor()
    else showCursor()
  }

  // --- Memo chain: store → committed → grouped → prevTypes ---
  // Each stage is a separate memo. Items are never wrapped in new objects —
  // store proxies pass through with stable identity (via reconcile() in sync).
  // Matches OpenCode's filtered → grouped → flat → selected pattern.

  // Stage 1: Filter out queued user blocks
  const committed = createMemo(() =>
    state.blocks.filter(b => !(b.type === "user" && b.queued))
  )
  const queuedBlocks = createMemo(() =>
    state.blocks.filter(b => b.type === "user" && b.queued) as Array<Extract<Block, { type: "user" }>>
  )

  // Stage 2: Group consecutive collapsible tools (collapsed view only)
  const grouped = createMemo((): GroupedItem[] =>
    viewLevel() !== "collapsed" ? committed() : groupConsecutiveTools(committed())
  )

  // Stage 3: Pre-compute prevType for each position (separate parallel array).
  // Read inside <Index> callback for margin logic — safe because it's a
  // separate memo from the list, no dual-update with reconciliation.
  const prevTypes = createMemo(() =>
    grouped().map((_item, i) => {
      const prev = i > 0 ? grouped()[i - 1] : undefined
      return prev ? (isToolGroup(prev) ? "tool" : (prev as Block).type) : undefined
    })
  )

  // Line-buffered streaming text: only show text up to the last newline.
  // Hides the in-progress partial line so text streams line-by-line, not
  // char-by-char. This prevents layout reflow jitter (partial lines constantly
  // change width), markdown mis-parsing of incomplete lines, and gives a
  // polished visual cadence. Same approach as Claude Code (REPL.tsx).
  const lineBufferedText = createMemo(() => {
    const raw = state.streamingText
    if (!raw) return null
    const lastNewline = raw.lastIndexOf("\n")
    if (lastNewline === -1) return null // No complete line yet
    return raw.substring(0, lastNewline + 1) || null
  })

  // Render throttle: decouple state-update rate (16ms) from visual-update
  // rate (~100ms). Prevents intermediate states that flash for <100ms from
  // ever being painted. Same approach as OpenCode (message-part.tsx).
  const visibleStreamingText = createThrottledValue<string | null>(() => lineBufferedText())
  const visibleThinking = createThrottledValue<string>(() => state.streamingThinking)

  // Tasks that have NO matching Agent tool block — these are "orphan" tasks
  // that should still be shown in the TaskView (e.g., background tasks started
  // before the tool block was created, or tasks from other sources).
  const orphanTasks = createMemo((): [string, import("../../protocol/types").TaskInfo][] => {
    const tasks = state.activeTasks
    if (tasks.length === 0) return []
    // Collect all Agent tool block IDs
    const agentToolIds = new Set<string>()
    for (const b of state.blocks) {
      if (b.type === "tool" && b.tool === "Agent") {
        agentToolIds.add(b.id)
      }
    }
    return tasks.filter(([, task]) => {
      if (task.toolUseId && agentToolIds.has(task.toolUseId)) return false
      return true
    })
  })

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
      if (b !== undefined && b.type === "tool" && b.status === "running") {
        if (isMcpTool(b.tool)) {
          const parsed = parseMcpToolName(b.tool)
          return `Running ${parsed.server} \u203A ${parsed.tool.replace(/_/g, " ")}...`
        }
        return `Running ${b.tool}...`
      }
    }
    return "Thinking..."
  }

  // Auto-scroll to bottom when permission/elicitation dialog appears
  // so the user can see and interact with it immediately.
  // Uses queueMicrotask to defer until after the current reactive pass
  // completes, avoiding the race between a 50ms setTimeout and layout
  // recalculation that caused visual jumps.
  createEffect(() => {
    const s = session.sessionState
    if (s === "WAITING_FOR_PERM" || s === "WAITING_FOR_ELIC") {
      setScrolledAway(false)
      queueMicrotask(() => scrollboxRef?.scrollBy(999999))
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

  // Ctrl+O toggles collapsed/expanded, Ctrl+Shift+E shows all, Ctrl+Shift+T toggles thinking
  // (Ctrl+E and Ctrl+T freed for Emacs end-of-line and transpose-chars)
  // Ctrl+Up/Down scrolls the conversation
  useKeyboard((event) => {
    if (event.ctrl && event.name === "o") {
      event.preventDefault()
      const next: ViewLevel = viewLevel() === "collapsed" ? "expanded" : "collapsed"
      // Snapshot whether the user was at the bottom before the content
      // height changes. After layout recalculates, re-anchor to bottom
      // so the viewport doesn't jump to earlier messages.
      const wasAtBottom = !userScrolledAway() || (scrollboxRef ? isNearBottom(scrollboxRef) : false)
      // Batch both signal updates so the block list and hint re-render
      // in a single reactive pass, preventing a flash between states.
      batch(() => {
        setViewLevel(next)
        showViewLevelHint(next)
      })
      if (wasAtBottom) {
        queueMicrotask(() => scrollboxRef?.scrollBy(999999))
      }
    }
    if (event.ctrl && event.shift && event.name === "e") {
      event.preventDefault()
      const next: ViewLevel = viewLevel() === "show_all" ? "collapsed" : "show_all"
      const wasAtBottom = !userScrolledAway() || (scrollboxRef ? isNearBottom(scrollboxRef) : false)
      batch(() => {
        setViewLevel(next)
        showViewLevelHint(next)
      })
      if (wasAtBottom) {
        queueMicrotask(() => scrollboxRef?.scrollBy(999999))
      }
    }
    if (event.ctrl && event.shift && event.name === "t") {
      event.preventDefault()
      const next = !showThinking()
      const wasAtBottom = !userScrolledAway() || (scrollboxRef ? isNearBottom(scrollboxRef) : false)
      batch(() => {
        setShowThinking(next)
        const text = next ? "Thinking: visible" : "Thinking: hidden"
        setViewLevelHint(text)
      })
      clearTimeout(viewLevelHintTimer)
      viewLevelHintTimer = setTimeout(() => setViewLevelHint(null), 2000)
      if (wasAtBottom) {
        queueMicrotask(() => scrollboxRef?.scrollBy(999999))
      }
    }
    if (event.ctrl && event.name === "up") {
      event.preventDefault()
      scrollboxRef?.scrollBy(-3)
      setScrolledAway(true)
      showScrollbarBriefly()
    }
    if (event.ctrl && event.name === "down") {
      event.preventDefault()
      scrollboxRef?.scrollBy(3)
      if (scrollboxRef && isNearBottom(scrollboxRef)) {
        setScrolledAway(false)
      }
      showScrollbarBriefly()
    }

    // Auto-scroll to bottom and refocus on any printable input while scrolled away
    if (userScrolledAway() && !event.ctrl && !event.option && !event.meta && event.name.length === 1) {
      scrollboxRef?.scrollBy(999999)
      setScrolledAway(false)
      // Don't preventDefault — let the keystroke reach the textarea
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
    <box flexDirection="column" flexGrow={1}>
      <scrollbox ref={(el: ScrollBoxRenderable) => { scrollboxRef = el; registerScrollToBottom(() => { setScrolledAway(false); queueMicrotask(() => el.scrollBy(999999)) }) }} stickyScroll={!userScrolledAway()} stickyStart="bottom" flexGrow={1}>
        <box flexDirection="column" paddingRight={1} minHeight="100%">
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

          {/* Quick-start tips — shown when conversation is empty */}
          <box flexDirection="column">
            <Show when={committed().length === 0 && !state.streamingText}>
              <box flexDirection="column" paddingLeft={2}>
                <text fg={colors.text.muted}>
                  {"Tips to get started:"}
                </text>
                <box marginTop={1} flexDirection="column">
                  <text fg={colors.text.secondary}>{"  \u2022  Ask a question or describe a task"}</text>
                  <text fg={colors.text.secondary}>{"  \u2022  Use @ to reference files: @src/index.ts"}</text>
                  <text fg={colors.text.secondary}>{"  \u2022  Type / for slash commands"}</text>
                  <text fg={colors.text.secondary}>{"  \u2022  Ctrl+O to expand tool details"}</text>
                  <text fg={colors.text.secondary}>{"  \u2022  Ctrl+Shift+P to switch models"}</text>
                </box>
              </box>
            </Show>
          </box>

          {/* Committed blocks (non-queued) — each block renders itself based on view level.
              In collapsed view, consecutive collapsible tools are merged into
              a single CollapsedToolGroup summary line. */}
          <box flexDirection="column">
            <Index each={grouped()}>
              {(item, index) => {
                // <Index> tracks by position. Items are unwrapped store proxies
                // (stable via reconcile()). prevTypes is a separate parallel memo
                // — no reactive coupling with the list reconciliation.
                const pt = () => prevTypes()[index]
                return (
                  <Show
                    when={!isToolGroup(item()) && item()}
                    fallback={
                      <box marginTop={pt() !== "tool" ? 1 : 0}>
                        <CollapsedToolGroup group={item() as ToolGroup} />
                      </box>
                    }
                  >
                    <BlockView
                      block={item() as Block}
                      viewLevel={viewLevel()}
                      prevType={pt()}
                      showThinking={showThinking()}
                    />
                  </Show>
                )
              }}
            </Index>
          </box>

          {/* Turn file change summary — shown when IDLE and files were changed */}
          <box flexDirection="column">
            <Show when={session.sessionState === "IDLE" && state.lastTurnFiles}>
              <TurnSummary files={state.lastTurnFiles!} />
            </Show>
          </box>

          {/* Streaming thinking (transient) — hidden when backgrounded, collapsed view, or thinking toggle off */}
          <box flexDirection="column">
            <Show when={!state.backgrounded && showThinking() && visibleThinking() && viewLevel() !== "collapsed"}>
              <box marginTop={1}>
                <ThinkingBlock text={visibleThinking()} collapsed={false} />
              </box>
            </Show>
          </box>

          {/* Streaming text (transient) — hidden when backgrounded.
              Uses visible={false} instead of <Show> to avoid destroying/recreating
              the <markdown> component at flush boundaries (tool_use_start,
              text_complete, turn_complete). Destroying forces all internal
              CodeRenderable sub-blocks to re-highlight from scratch, leaving
              text invisible for 1+ frames while async tree-sitter completes. */}
          <box flexDirection="column">
            <box flexDirection="row" marginTop={1} visible={!state.backgrounded && !!visibleStreamingText()}>
              <box width={2} flexShrink={0}>
                <text fg={colors.accent.primary}>{"\u23FA"}</text>
              </box>
              <box flexGrow={1}>
                <markdown content={visibleStreamingText() ?? undefined} syntaxStyle={syntaxStyle} streaming={true} fg={colors.text.primary} />
              </box>
            </box>
          </box>

          {/* Queued user messages (muted, after streaming) */}
          <box flexDirection="column">
            <For each={queuedBlocks()}>
              {(block) => <QueuedMessage block={block} />}
            </For>
          </box>

          {/* Transient view-level hint — replaces itself, auto-clears after 3s.
              Wrapped in Show so it takes 0 space when empty — the spinner's
              marginTop={1} provides the single blank-line gap. */}
          <Show when={viewLevelHint()}>
            <EphemeralLine message={viewLevelHint()} />
          </Show>

          {/* Background task indicator — compact single-line when backgrounded */}
          <box flexDirection="column">
            <Show when={state.backgrounded && session.sessionState === "RUNNING"}>
              <box marginTop={1} paddingLeft={2} flexDirection="row">
                <StreamingSpinner label={"Running in background..."} elapsedSeconds={turnElapsed()} outputTokens={state.streamingOutputTokens || session.cost.outputTokens} />
              </box>
            </Show>
          </box>

          {/* Spinner — visible during RUNNING when there's no other visual activity.
              Hidden while text is actively streaming since that already signals progress. */}
          <box flexDirection="column">
            <Show when={
              session.sessionState === "RUNNING" &&
              !state.backgrounded &&
              !state.streamingText
            }>
              <box marginTop={1} paddingLeft={2}>
                <StreamingSpinner label={spinnerLabel()} elapsedSeconds={turnElapsed()} outputTokens={state.streamingOutputTokens || session.cost.outputTokens} />
              </box>
            </Show>
          </box>

          {/* Background tasks / subagents — only show tasks NOT already
              rendered inline by AgentToolView (those with a matching tool block) */}
          <box flexDirection="column">
            <Show when={orphanTasks().length > 0}>
              <TaskView tasks={orphanTasks()} />
            </Show>
          </box>

          {/* Spacer — pushes footer to bottom when content is short.
              Combined with minHeight="100%" on the parent, this ensures
              the input area stays at the bottom of the viewport until
              conversation content pushes it further down — then scrolling
              up moves everything (including the input) off-screen. */}
          <box flexGrow={1} />

          {/* Toast notifications — above input area */}
          <box flexDirection="column" flexShrink={0}>
            <ToastDisplay />
          </box>

          {/* Ephemeral hint line — always 1 row tall, sits between content and input */}
          <EphemeralLine message={props.footerHint} />

          {/* Input area, status bar, dialogs — scrolls with content */}
          <box flexDirection="column" flexShrink={0} paddingBottom={1}>
            {props.children}
          </box>
        </box>
      </scrollbox>
    </box>
  )
}
