/**
 * Conversation View — Scrollbox with sticky scroll
 *
 * Renders all messages, streaming content, active tools.
 * Uses OpenTUI stickyScroll for auto-following.
 * Ctrl+O toggles tool view level, Ctrl+E shows all.
 */

import { createSignal, onCleanup, For, Show, Index } from "solid-js"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useMessages } from "../context/messages"
import { useSession } from "../context/session"
import type { Message, MessageContent } from "../../protocol/types"
import { ThinkingBlock } from "./thinking-block"
import { ToolView } from "./tool-view"
import { TaskView } from "./task-view"

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

type ViewLevel = "collapsed" | "expanded" | "show_all"

function MessageContentView(props: {
  content: MessageContent
  viewLevel: ViewLevel
}) {
  switch (props.content.type) {
    case "text":
      return <markdown content={props.content.text} />
    case "thinking":
      return (
        <ThinkingBlock
          text={props.content.text}
          collapsed={props.viewLevel === "collapsed"}
        />
      )
    case "tool_use":
      return null // Rendered by ToolView
    case "tool_result":
      return null // Rendered by ToolView
    case "compact":
      return (
        <box paddingTop={1} paddingBottom={1}>
          <text color="gray" dimmed>
            {"── Context compacted ──"}
          </text>
        </box>
      )
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Turn separator — thin line between turns for visual separation
// ---------------------------------------------------------------------------

function TurnSeparator() {
  return (
    <box paddingTop={1} paddingBottom={0}>
      <text color="gray" dimmed>
        {"────────────────────────────────────────"}
      </text>
    </box>
  )
}

function MessageBlock(props: {
  message: Message
  viewLevel: ViewLevel
  isFirstMessage: boolean
  previousRole?: "user" | "assistant" | "system"
}) {
  const isUser = () => props.message.role === "user"
  const isSystem = () => props.message.role === "system"
  const isAssistant = () => props.message.role === "assistant"

  // Show turn separator when transitioning between user and assistant
  const showSeparator = () => {
    if (props.isFirstMessage) return false
    const prev = props.previousRole
    const curr = props.message.role
    // Separator on role transitions (user->assistant, assistant->user)
    return prev !== undefined && prev !== curr && prev !== "system" && curr !== "system"
  }

  // Extract text/thinking content vs tool content
  const textContent = () =>
    props.message.content.filter(
      (c) => c.type === "text" || c.type === "thinking" || c.type === "compact",
    )

  const toolResults = () => {
    const results: any[] = []
    for (const c of props.message.content) {
      if (c.type === "tool_result") {
        const toolUse = props.message.content.find(
          (tc) => tc.type === "tool_use" && tc.id === c.id,
        )
        results.push({
          id: c.id,
          tool: toolUse?.type === "tool_use" ? toolUse.tool : "unknown",
          input: toolUse?.type === "tool_use" ? toolUse.input : {},
          output: c.output,
          error: c.error,
          duration: 0,
        })
      }
    }
    return results
  }

  return (
    <box flexDirection="column">
      {/* Turn separator between role transitions */}
      <Show when={showSeparator()}>
        <TurnSeparator />
      </Show>

      {/* User message — bold blue prefix, left border, top margin */}
      <Show when={isUser()}>
        <box
          flexDirection="column"
          marginTop={props.isFirstMessage ? 0 : 1}
          borderLeft
          borderColor="blue"
          paddingLeft={1}
        >
          <box flexDirection="row">
            <text color="blue" bold>
              {"> "}
            </text>
            <For each={textContent()}>
              {(content) => (
                <MessageContentView
                  content={content}
                  viewLevel={props.viewLevel}
                />
              )}
            </For>
          </box>
        </box>
      </Show>

      {/* System message — dimmed italic with info prefix */}
      <Show when={isSystem()}>
        <box flexDirection="column" paddingLeft={2} marginTop={1}>
          <For each={textContent()}>
            {(content) => (
              <text color="gray" dimmed italic>
                {content.type === "text" ? `\u2139 ${content.text}` : ""}
              </text>
            )}
          </For>
        </box>
      </Show>

      {/* Assistant message — left border in cyan, markdown rendering */}
      <Show when={isAssistant()}>
        <box
          flexDirection="column"
          borderLeft
          borderColor="cyan"
          paddingLeft={1}
        >
          <For each={textContent()}>
            {(content) => (
              <MessageContentView
                content={content}
                viewLevel={props.viewLevel}
              />
            )}
          </For>
          <Show when={toolResults().length > 0}>
            <ToolView
              completedTools={toolResults()}
              activeTools={[]}
              viewLevel={props.viewLevel}
            />
          </Show>
        </box>
      </Show>
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
        {/* Welcome message when empty */}
        <Show
          when={
            state.messages.length === 0 &&
            !state.streamingText &&
            session.sessionState === "IDLE"
          }
        >
          <text color="gray">
            Welcome to claude-opentui. Type a message to begin.
          </text>
        </Show>

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

        {/* Streaming text (live) — styled as assistant with left border */}
        <Show when={state.streamingText}>
          <box borderLeft borderColor="cyan" paddingLeft={1}>
            <markdown content={state.streamingText} />
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
