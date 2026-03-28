/**
 * Conversation View — Scrollbox with sticky scroll
 *
 * Renders all messages, streaming content, active tools.
 * Uses OpenTUI stickyScroll for auto-following.
 * Ctrl+O toggles tool view level, Ctrl+E shows all.
 */

import { createSignal, createEffect, onCleanup, Show, Index } from "solid-js"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useMessages } from "../context/messages"
import { useSession } from "../context/session"
import { ThinkingBlock } from "./thinking-block"
import { ToolView } from "./tool-view"
import type { ViewLevel } from "./tool-view"
import { TaskView } from "./task-view"
import { MessageBlock } from "./message-block"

// ---------------------------------------------------------------------------
// Braille spinner — animated activity indicator
// ---------------------------------------------------------------------------

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
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
      <text color="gray" dimmed>
        {SPINNER_FRAMES[frameIndex()]} {props.label}
      </text>
    </box>
  )
}

export function ConversationView() {
  const { state } = useMessages()
  const { state: session } = useSession()
  const [viewLevel, setViewLevel] = createSignal<ViewLevel>("collapsed")
  let scrollboxRef: ScrollBoxRenderable | undefined

  // Derive spinner label from active tools
  const spinnerLabel = () => {
    if (state.activeTools.length > 0) {
      // Show the name of the first active tool
      const [, tool] = state.activeTools[0]
      return `Running ${tool.tool}...`
    }
    return "Thinking..."
  }

  // Re-engage stickyScroll when new messages arrive.
  // When the user manually scrolls up (Ctrl+Up), OpenTUI disengages stickyScroll.
  // After sending a new message, we want to scroll back to the bottom so
  // stickyScroll re-engages and streaming content stays visible.
  let prevMessageCount = 0
  createEffect(() => {
    const count = state.messages.length
    if (count > prevMessageCount) {
      // scrollBy(1, "content") scrolls to 100% of content = end
      scrollboxRef?.scrollBy(1, "content")
    }
    prevMessageCount = count
  })

  // Ctrl+O toggles collapsed/expanded, Ctrl+E shows all
  // Ctrl+Up/Down scrolls the conversation
  useKeyboard((event) => {
    if (event.ctrl && event.name === "o") {
      setViewLevel((prev) =>
        prev === "collapsed" ? "expanded" : "collapsed",
      )
    }
    if (event.ctrl && event.name === "e") {
      setViewLevel((prev) =>
        prev === "show_all" ? "collapsed" : "show_all",
      )
    }
    // Scroll shortcuts
    if (event.ctrl && event.name === "up") {
      scrollboxRef?.scrollBy(-3)
    }
    if (event.ctrl && event.name === "down") {
      scrollboxRef?.scrollBy(3)
    }
  })

  return (
    <scrollbox ref={scrollboxRef} stickyScroll stickyStart="bottom" flexGrow={1}>
      <box flexDirection="column" gap={1} padding={1}>
        {/* Rendered messages */}
        <Index each={state.messages}>
          {(message, index) => (
            <MessageBlock
              message={message()}
              viewLevel={viewLevel()}
              isFirstMessage={index === 0}
              previousRole={index > 0 ? state.messages[index - 1]?.role : undefined}
            />
          )}
        </Index>

        {/* Active tools (during streaming) */}
        <Show
          when={
            state.activeTools.length > 0 || state.completedTools.length > 0
          }
        >
          <ToolView
            completedTools={state.completedTools}
            activeTools={state.activeTools}
            viewLevel={viewLevel()}
          />
        </Show>

        {/* Streaming thinking (live) */}
        <Show when={state.streamingThinking}>
          <ThinkingBlock text={state.streamingThinking} collapsed={false} />
        </Show>

        {/* Streaming text (live) — styled as assistant with prefix */}
        <Show when={state.streamingText}>
          <box flexDirection="row">
            <text color="white">
              {"● "}
            </text>
            <box flexGrow={1}>
              <markdown content={state.streamingText} />
            </box>
          </box>
        </Show>

        {/* Streaming spinner — visible when agent is working but no text yet */}
        <Show
          when={
            session.sessionState === "RUNNING" &&
            !state.streamingText &&
            !state.streamingThinking
          }
        >
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
            <text color="red" bold>
              Error: {session.lastError!.code}
            </text>
            <text color="red">{session.lastError!.message}</text>
          </box>
        </Show>
      </box>
    </scrollbox>
  )
}
