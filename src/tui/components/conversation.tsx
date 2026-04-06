/**
 * Conversation View — Scrollbox with manual scroll management
 *
 * Renders all blocks, streaming content, active tools.
 * Auto-scrolls during streaming via a 200ms nudge timer, but respects
 * user scroll position — if the user scrolls up, auto-scroll disengages.
 * Re-engages when user scrolls back to bottom or sends a new message.
 * Ctrl+O toggles tool view level, Ctrl+E shows all.
 */

import type { JSX } from "solid-js"
import { createSignal, createEffect, createMemo, onCleanup, Show, For, batch } from "solid-js"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useMessages } from "../context/messages"
import { useSession } from "../context/session"
import { ThinkingBlock } from "./thinking-block"
import { TaskView } from "./task-view"
import { syntaxStyle } from "../theme"
import { colors } from "../theme/tokens"
import { HeaderBar } from "./header-bar"
import type { Block } from "../../protocol/types"
import { refocusInput, blurInput, registerScrollToBottom } from "./input-area"
import { StreamingSpinner } from "./streaming-spinner"
import { type ViewLevel } from "./tool-view"
import { BlockView } from "./block-view"
import { CollapsedToolGroup } from "./collapsed-tool-group"
import { ToastDisplay } from "./toast"
import { groupConsecutiveTools, isToolGroup, type GroupedItem } from "../utils/tool-grouping"
import { TurnSummary } from "./turn-summary"
import { QueuedMessage } from "./blocks/queued-message"

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

export function ConversationView(props: { children?: JSX.Element }) {
  const { state } = useMessages()
  const { state: session } = useSession()
  const [viewLevel, setViewLevel] = createSignal<ViewLevel>("collapsed")
  const [showThinking, setShowThinking] = createSignal(true)
  const [viewLevelHint, setViewLevelHint] = createSignal<string | null>(null)
  let viewLevelHintTimer: ReturnType<typeof setTimeout> | undefined
  let scrollboxRef: ScrollBoxRenderable | undefined
  const [userScrolledAway, setUserScrolledAway] = createSignal(false)

  // Derived: separate queued vs non-queued blocks
  const nonQueuedBlocks = () => state.blocks.filter(b => !(b.type === "user" && b.queued))
  const queuedBlocks = () => state.blocks.filter(b => b.type === "user" && b.queued) as Array<Extract<Block, { type: "user" }>>

  // Group consecutive collapsible tool blocks when in collapsed view
  const groupedBlocks = createMemo((): GroupedItem[] => {
    if (viewLevel() !== "collapsed") return nonQueuedBlocks()
    return groupConsecutiveTools(nonQueuedBlocks())
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
      if (b.type === "tool" && b.status === "running") {
        return `Running ${b.tool}...`
      }
    }
    return "Thinking..."
  }

  // Periodic scroll nudge during streaming.
  // Uses a 200ms interval (not per-delta) to avoid scroll thrashing
  // that was fixed in commit 91901ca.
  // Does NOT reset userScrolledAway on streaming start — if the user was
  // scrolled up reading earlier content, we respect that position.
  let scrollNudgeTimer: ReturnType<typeof setInterval> | undefined
  let lastKnownScrollTop: number | undefined
  createEffect(() => {
    const isStreaming = !!(state.streamingText || state.streamingThinking)
    if (isStreaming) {
      if (!scrollNudgeTimer) {
        // Initial nudge — only if user hasn't scrolled away
        if (!userScrolledAway()) {
          scrollboxRef?.scrollBy(1, "content")
        }
        if (scrollboxRef) lastKnownScrollTop = scrollboxRef.scrollTop
        // Periodic nudge every 200ms — only when user hasn't scrolled away
        scrollNudgeTimer = setInterval(() => {
          // Detect external scroll (mouse wheel): if scrollTop moved upward
          // since last check without us nudging, the user scrolled away
          if (scrollboxRef && lastKnownScrollTop !== undefined) {
            if (scrollboxRef.scrollTop < lastKnownScrollTop) {
              setUserScrolledAway(true)
            }
            // Re-engage auto-scroll if user scrolled back to bottom
            if (!userScrolledAway() || isNearBottom(scrollboxRef)) {
              setUserScrolledAway(false)
            }
          }
          if (!userScrolledAway()) {
            scrollboxRef?.scrollBy(1, "content")
          }
          if (scrollboxRef) lastKnownScrollTop = scrollboxRef.scrollTop
        }, 200)
      }
    } else {
      if (scrollNudgeTimer) {
        clearInterval(scrollNudgeTimer)
        scrollNudgeTimer = undefined
        lastKnownScrollTop = undefined
      }
    }
  })
  onCleanup(() => {
    if (scrollNudgeTimer) {
      clearInterval(scrollNudgeTimer)
    }
  })

  // Auto-scroll to bottom when permission/elicitation dialog appears
  // so the user can see and interact with it immediately.
  // Uses queueMicrotask to defer until after the current reactive pass
  // completes, avoiding the race between a 50ms setTimeout and layout
  // recalculation that caused visual jumps.
  createEffect(() => {
    const state = session.sessionState
    if (state === "WAITING_FOR_PERM" || state === "WAITING_FOR_ELIC") {
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

  // Ctrl+O toggles collapsed/expanded, Ctrl+E shows all, Ctrl+T toggles thinking
  // Ctrl+Up/Down scrolls the conversation
  useKeyboard((event) => {
    if (event.ctrl && event.name === "o") {
      event.preventDefault()
      const next: ViewLevel = viewLevel() === "collapsed" ? "expanded" : "collapsed"
      // Batch both signal updates so the block list and hint re-render
      // in a single reactive pass, preventing a flash between states.
      batch(() => {
        setViewLevel(next)
        showViewLevelHint(next)
      })
    }
    if (event.ctrl && event.name === "e") {
      event.preventDefault()
      const next: ViewLevel = viewLevel() === "show_all" ? "collapsed" : "show_all"
      batch(() => {
        setViewLevel(next)
        showViewLevelHint(next)
      })
    }
    if (event.ctrl && event.name === "t") {
      event.preventDefault()
      const next = !showThinking()
      batch(() => {
        setShowThinking(next)
        const text = next ? "Thinking: visible" : "Thinking: hidden"
        setViewLevelHint(text)
      })
      clearTimeout(viewLevelHintTimer)
      viewLevelHintTimer = setTimeout(() => setViewLevelHint(null), 2000)
    }
    if (event.ctrl && event.name === "up") {
      event.preventDefault()
      scrollboxRef?.scrollBy(-3)
      setUserScrolledAway(true)
      showScrollbarBriefly()
      blurInput()  // Hide cursor when scrolled away from input
    }
    if (event.ctrl && event.name === "down") {
      event.preventDefault()
      scrollboxRef?.scrollBy(3)
      // Only re-engage auto-scroll and refocus when back at bottom
      if (scrollboxRef && isNearBottom(scrollboxRef)) {
        setUserScrolledAway(false)
        refocusInput()
      }
      showScrollbarBriefly()
    }

    // Auto-scroll to bottom and refocus on any printable input while scrolled away
    if (userScrolledAway() && !event.ctrl && !event.option && !event.meta && event.name.length === 1) {
      scrollboxRef?.scrollBy(999999)
      setUserScrolledAway(false)
      refocusInput()
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
      <scrollbox ref={(el: ScrollBoxRenderable) => { scrollboxRef = el; registerScrollToBottom(() => { setUserScrolledAway(false); queueMicrotask(() => el.scrollBy(999999)) }) }} flexGrow={1}>
        <box flexDirection="column" paddingRight={1} paddingBottom={1}>
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
            <Show when={nonQueuedBlocks().length === 0 && !state.streamingText}>
              <box flexDirection="column" paddingLeft={2}>
                <text fg={colors.text.muted} attributes={TextAttributes.DIM}>
                  {"Tips to get started:"}
                </text>
                <box marginTop={1} flexDirection="column">
                  <text fg={colors.text.secondary}>{"  \u2022  Ask a question or describe a task"}</text>
                  <text fg={colors.text.secondary}>{"  \u2022  Use @ to reference files: @src/index.ts"}</text>
                  <text fg={colors.text.secondary}>{"  \u2022  Type / for slash commands"}</text>
                  <text fg={colors.text.secondary}>{"  \u2022  Ctrl+O to expand tool details"}</text>
                  <text fg={colors.text.secondary}>{"  \u2022  Ctrl+P to switch models"}</text>
                </box>
              </box>
            </Show>
          </box>

          {/* Committed blocks (non-queued) — each block renders itself based on view level.
              In collapsed view, consecutive collapsible tools are merged into
              a single CollapsedToolGroup summary line. */}
          <box flexDirection="column">
            <For each={groupedBlocks()}>
              {(item, index) => {
                const items = groupedBlocks()
                // Determine the type of the previous item for turn-separator logic
                const prevItem = index() > 0 ? items[index() - 1] : undefined
                const prevType = prevItem
                  ? isToolGroup(prevItem) ? "tool" : (prevItem as Block).type
                  : undefined

                if (isToolGroup(item)) {
                  return (
                    <box marginTop={prevType !== "tool" ? 1 : 0}>
                      <CollapsedToolGroup group={item} />
                    </box>
                  )
                }

                return (
                  <BlockView
                    block={item as Block}
                    viewLevel={viewLevel()}
                    prevType={prevType}
                    showThinking={showThinking()}
                  />
                )
              }}
            </For>
          </box>

          {/* Turn file change summary — shown when IDLE and files were changed */}
          <box flexDirection="column">
            <Show when={session.sessionState === "IDLE" && state.lastTurnFiles}>
              <TurnSummary files={state.lastTurnFiles!} />
            </Show>
          </box>

          {/* Streaming thinking (transient) — hidden when backgrounded, collapsed view, or thinking toggle off */}
          <box flexDirection="column">
            <Show when={!state.backgrounded && showThinking() && state.streamingThinking && viewLevel() !== "collapsed"}>
              <box marginTop={1}>
                <ThinkingBlock text={state.streamingThinking} collapsed={false} />
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
            <box flexDirection="row" marginTop={1} visible={!state.backgrounded && !!state.streamingText}>
              <box width={2} flexShrink={0}>
                <text fg={colors.text.white}>{"\u23FA"}</text>
              </box>
              <box flexGrow={1}>
                <markdown content={state.streamingText} syntaxStyle={syntaxStyle} streaming={true} fg={colors.text.primary} />
              </box>
            </box>
          </box>

          {/* Queued user messages (muted, after streaming) */}
          <box flexDirection="column">
            <For each={queuedBlocks()}>
              {(block) => <QueuedMessage block={block} />}
            </For>
          </box>

          {/* Transient view-level hint — replaces itself, auto-clears after 3s */}
          <box flexDirection="column" paddingLeft={2}>
            <Show when={viewLevelHint()}>
              <text fg={colors.text.muted} attributes={TextAttributes.DIM}>{viewLevelHint()}</text>
            </Show>
          </box>

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

          {/* Background tasks / subagents */}
          <box flexDirection="column">
            <Show when={state.activeTasks.length > 0}>
              <TaskView tasks={state.activeTasks} />
            </Show>
          </box>
        </box>
      </scrollbox>

      {/* Toast notifications — above input area */}
      <box flexDirection="column" flexShrink={0}>
        <ToastDisplay />
      </box>

      {/* Input area, status bar, dialogs — fixed below scrollbox */}
      <box flexDirection="column" flexShrink={0} paddingBottom={1}>
        {props.children}
      </box>
    </box>
  )
}
