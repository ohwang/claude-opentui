/**
 * Message Block — User/assistant/system message rendering
 *
 * Renders a single message with role-specific styling:
 * - User: dimmed gray ">" prefix, no border
 * - Assistant: "●" prefix, no border, markdown rendering
 * - System: dimmed italic with info prefix
 *
 * Turn spacing via marginTop only — no separators.
 */

import { For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import type { Message, MessageContent } from "../../protocol/types"
import { ThinkingBlock } from "./thinking-block"
import { syntaxStyle } from "../theme"
import { ToolView } from "./tool-view"
import type { ViewLevel } from "./tool-view"

// ---------------------------------------------------------------------------
// Message content renderer — dispatches by content type
// ---------------------------------------------------------------------------

function MessageContentView(props: {
  content: MessageContent
  viewLevel: ViewLevel
}) {
  switch (props.content.type) {
    case "text":
      return <markdown content={props.content.text} syntaxStyle={syntaxStyle} />
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
          <text fg="gray" attributes={TextAttributes.DIM}>
            {"── Context compacted ──"}
          </text>
        </box>
      )
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// MessageBlock — renders a single message with role-specific styling
// ---------------------------------------------------------------------------

export function MessageBlock(props: {
  message: Message
  viewLevel: ViewLevel
  isFirstMessage: boolean
  previousRole?: "user" | "assistant" | "system"
}) {
  const isUser = () => props.message.role === "user"
  const isSystem = () => props.message.role === "system"
  const isAssistant = () => props.message.role === "assistant"

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
      {/* User message — dimmed gray ">" prefix, no border */}
      <Show when={isUser()}>
        <box
          flexDirection="column"
          marginTop={props.isFirstMessage ? 0 : 1}
        >
          <box flexDirection="row">
            <text fg="gray" attributes={TextAttributes.DIM}>
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
              <text fg="gray" attributes={TextAttributes.DIM | TextAttributes.ITALIC}>
                {content.type === "text" ? `\u2139 ${content.text}` : ""}
              </text>
            )}
          </For>
        </box>
      </Show>

      {/* Assistant message — "●" prefix, no border, markdown rendering */}
      <Show when={isAssistant()}>
        <box
          flexDirection="column"
          marginTop={props.isFirstMessage ? 0 : 1}
        >
          <box flexDirection="row">
            <text fg="white">
              {"⏺ "}
            </text>
            <box flexDirection="column" flexGrow={1}>
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
