/**
 * Input Area — Textarea with message submission + slash commands
 *
 * Enter to send, Shift+Enter for newline.
 * Input stays enabled during RUNNING (messages queued).
 * '/' at position 0 triggers slash command dispatch.
 */

import { createSignal } from "solid-js"
import type { TextareaRenderable, KeyEvent } from "@opentui/core"
import { useAgent } from "../context/agent"
import { useSession } from "../context/session"
import { useMessages } from "../context/messages"
import { useSync } from "../context/sync"
import { createCommandRegistry } from "../../commands/registry"

const commandRegistry = createCommandRegistry()

// Input history for Up/Down arrow recall
const inputHistory: string[] = []
let historyIndex = -1
let savedInput = ""

/**
 * Clear the input area text. Called by the global Ctrl+C handler in Layout
 * when the session is IDLE.
 * Returns true if there was text to clear, false if already empty.
 */
export function clearInput(): boolean {
  if (!_sharedTextareaRef) return false
  const text = _sharedTextareaRef.plainText?.trim()
  if (!text) return false
  _sharedTextareaRef.clear()
  return true
}

/** Module-level ref so clearInput() can access the textarea */
let _sharedTextareaRef: TextareaRenderable | undefined

export function InputArea() {
  const agent = useAgent()
  const { state: session } = useSession()
  const { setState: setMessages } = useMessages()
  const sync = useSync()
  let textareaRef: TextareaRenderable | undefined
  const [completionHint, setCompletionHint] = createSignal("")
  let tabIndex = -1
  let tabMatches: string[] = []
  let lastTabText = ""

  const placeholder = () => {
    switch (session.sessionState) {
      case "INITIALIZING":
        return "Starting..."
      case "IDLE":
        return "Type a message... (Enter to send, / for commands)"
      case "RUNNING":
        return "Type a message... (will be queued)"
      case "WAITING_FOR_PERM":
        return "Waiting for permission response (y/n/a)..."
      case "WAITING_FOR_ELIC":
        return "Waiting for your choice..."
      case "INTERRUPTING":
        return "Interrupting..."
      case "ERROR":
        return "Error occurred. Type to retry."
      default:
        return "Type a message..."
    }
  }

  const isDisabled = () =>
    session.sessionState === "WAITING_FOR_PERM" ||
    session.sessionState === "WAITING_FOR_ELIC" ||
    session.sessionState === "SHUTTING_DOWN"

  const submit = async () => {
    if (!textareaRef) return
    const text = textareaRef.plainText?.trim()
    if (!text) return

    // Try slash command first
    const handled = await commandRegistry.tryExecute(text, {
      backend: agent.backend,
      pushEvent: sync.pushEvent,
      clearMessages: () => {
        setMessages({ messages: [], streamingText: "", streamingThinking: "" })
      },
      setModel: (model: string) => agent.backend.setModel(model),
    })

    if (!handled) {
      // Show the user message in the conversation immediately
      sync.pushEvent({ type: "user_message", text })
      // Send to backend (queued if a turn is running)
      agent.backend.sendMessage({ text })
    }

    // Push to history (avoid duplicating last entry)
    if (inputHistory[inputHistory.length - 1] !== text) {
      inputHistory.push(text)
    }
    historyIndex = -1
    savedInput = ""

    textareaRef.clear()
  }

  const setTextareaContent = (text: string) => {
    if (!textareaRef) return
    textareaRef.clear()
    if (text) textareaRef.insertText(text)
  }

  const handleKeyDown = (e: KeyEvent) => {
    // Escape = dismiss completion or clear input
    if (e.name === "escape") {
      e.preventDefault()
      if (tabMatches.length > 0) {
        // Dismiss active tab completion
        setCompletionHint("")
        tabIndex = -1
        tabMatches = []
      } else {
        // Clear the textarea
        textareaRef?.clear()
        historyIndex = -1
        savedInput = ""
      }
      return
    }

    // Clear completion hint on non-Tab keys
    if (e.name !== "tab") {
      setCompletionHint("")
      tabIndex = -1
      tabMatches = []
    }

    // Enter without shift/meta = submit
    if (e.name === "return" && !e.shift && !e.meta) {
      e.preventDefault()
      submit()
      return
    }

    // Tab = slash command completion
    if (e.name === "tab") {
      e.preventDefault()
      const text = textareaRef?.plainText ?? ""
      if (text.startsWith("/")) {
        const query = text.slice(1).split(/\s/)[0]

        // If this is the first Tab press or text changed, refresh matches
        if (lastTabText !== text || tabMatches.length === 0) {
          tabMatches = commandRegistry
            .search(query)
            .map((cmd) => `/${cmd.name}`)
          tabIndex = 0
          lastTabText = text
        } else {
          // Cycle through matches
          tabIndex = (tabIndex + 1) % tabMatches.length
        }

        if (tabMatches.length > 0) {
          setTextareaContent(tabMatches[tabIndex] + " ")
          // Show all matches as hint
          const others = tabMatches
            .filter((_, i) => i !== tabIndex)
            .join("  ")
          setCompletionHint(others ? `  ${others}` : "")
        }
      }
      return
    }

    // Up arrow = recall previous history entry
    if (e.name === "up" && inputHistory.length > 0) {
      e.preventDefault()
      if (historyIndex === -1) {
        // Save current input before navigating history
        savedInput = textareaRef?.plainText ?? ""
        historyIndex = inputHistory.length - 1
      } else if (historyIndex > 0) {
        historyIndex--
      }
      setTextareaContent(inputHistory[historyIndex])
      return
    }

    // Down arrow = move forward in history
    if (e.name === "down" && historyIndex !== -1) {
      e.preventDefault()
      if (historyIndex < inputHistory.length - 1) {
        historyIndex++
        setTextareaContent(inputHistory[historyIndex])
      } else {
        // Past the end = restore saved input
        historyIndex = -1
        setTextareaContent(savedInput)
      }
      return
    }
  }

  return (
    <box flexDirection="column">
      <box flexDirection="row">
        <textarea
          ref={(el: TextareaRenderable) => { textareaRef = el; _sharedTextareaRef = el }}
          focused={!isDisabled()}
          height={2}
          placeholder={placeholder()}
          keyBindings={[
            { name: "return", action: "submit" },
            { name: "return", shift: true, action: "newline" },
            { name: "return", meta: true, action: "newline" },
          ]}
          onKeyDown={handleKeyDown}
          onSubmit={submit}
          flexGrow={1}
        />
        {completionHint() ? (
          <text color="gray" dimmed>
            {completionHint()}
          </text>
        ) : null}
      </box>
    </box>
  )
}

/** Exported for testing */
export { commandRegistry }
