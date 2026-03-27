/**
 * Conversation View — Scrollbox with sticky scroll
 *
 * Renders all messages, streaming content, active tools.
 * Uses OpenTUI stickyScroll for auto-following.
 * Ctrl+O toggles tool view level, Ctrl+E shows all.
 */

import { createSignal, For, Show } from "solid-js"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useMessages } from "../context/messages"
import { useSession } from "../context/session"
import type { Message, MessageContent } from "../../protocol/types"
import { ThinkingBlock } from "./thinking-block"
import { ToolView } from "./tool-view"
import { TaskView } from "./task-view"

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

function MessageBlock(props: { message: Message; viewLevel: ViewLevel }) {
  const isUser = () => props.message.role === "user"

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
      <Show when={isUser()}>
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
      </Show>
      <Show when={props.message.role === "system"}>
        <For each={textContent()}>
          {(content) => (
            <box>
              <text color="gray" dimmed>
                {content.type === "text" ? content.text : ""}
              </text>
            </box>
          )}
        </For>
      </Show>
      <Show when={props.message.role === "assistant"}>
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
      </Show>
    </box>
  )
}

export function ConversationView() {
  const { state } = useMessages()
  const { state: session } = useSession()
  const [viewLevel, setViewLevel] = createSignal<ViewLevel>("collapsed")
  let scrollboxRef: ScrollBoxRenderable | undefined

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
        <For each={state.messages}>
          {(message) => (
            <MessageBlock message={message} viewLevel={viewLevel()} />
          )}
        </For>

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

        {/* Streaming text (live) */}
        <Show when={state.streamingText}>
          <markdown content={state.streamingText} />
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
