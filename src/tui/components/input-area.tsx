/**
 * Input Area — Textarea with message submission + slash commands
 *
 * Enter to send, Shift+Enter for newline.
 * Input stays enabled during RUNNING (messages queued).
 * '/' at position 0 triggers slash command autocomplete dropdown.
 */

import { createSignal, Show, For } from "solid-js"
import { TextAttributes, type TextareaRenderable, type KeyEvent, type CliRenderer } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { tmpdir } from "os"
import { join } from "path"
import { writeFileSync, readFileSync, unlinkSync } from "fs"
import { useAgent } from "../context/agent"
import { useSession } from "../context/session"
import { useSync } from "../context/sync"
import { createCommandRegistry, type SlashCommand } from "../../commands/registry"
import { triggerCleanExit } from "../app"
import { log } from "../../utils/logger"

const commandRegistry = createCommandRegistry()

/** Maximum number of items visible in the autocomplete dropdown */
const MAX_VISIBLE_ITEMS = 6

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
  _resetLineCount?.()
  return true
}

/**
 * Re-focus the textarea. Called after scroll or any event that may have
 * shifted OpenTUI focus away from the input area.
 *
 * In native Claude Code the textarea always captures keyboard input —
 * the user can scroll up to read history, then just start typing.
 * This function ensures the same behavior by reclaiming focus.
 */
export function refocusInput(): void {
  _sharedTextareaRef?.focus()
}

/** Module-level ref so clearInput() can access the textarea */
let _sharedTextareaRef: TextareaRenderable | undefined
/** Module-level callback to reset line count when clearInput() is called externally */
let _resetLineCount: (() => void) | undefined

/**
 * Open the user's preferred editor ($VISUAL or $EDITOR, falling back to vi)
 * with the current input text. On save+quit, the edited content replaces
 * the textarea input. The TUI renderer is suspended while the editor runs.
 *
 * Ctrl+G keybinding — matches Claude Code behavior.
 */
async function openExternalEditor(
  textareaRef: TextareaRenderable | undefined,
  renderer: CliRenderer,
): Promise<void> {
  const editor = process.env["VISUAL"] || process.env["EDITOR"] || "vi"
  const tmpFile = join(tmpdir(), `claude-opentui-${Date.now()}.md`)

  // Write current input to temp file
  const currentText = textareaRef?.plainText ?? ""
  writeFileSync(tmpFile, currentText)

  try {
    // Suspend TUI rendering so the editor can take over the terminal
    renderer.suspend()
    renderer.currentRenderBuffer.clear()

    try {
      const parts = editor.split(/\s+/)
      const proc = Bun.spawn([...parts, tmpFile], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      })
      await proc.exited

      // Read back the edited content
      const newText = readFileSync(tmpFile, "utf-8").trimEnd()
      if (textareaRef) {
        textareaRef.clear()
        if (newText) {
          textareaRef.insertText(newText)
        }
      }
    } finally {
      // Always resume the TUI, even if the editor crashed
      renderer.currentRenderBuffer.clear()
      renderer.resume()
      renderer.requestRender()
    }
  } catch (err) {
    log.warn("External editor failed", { error: String(err) })
  } finally {
    try { unlinkSync(tmpFile) } catch {}
  }
}

export function InputArea() {
  const agent = useAgent()
  const { state: session } = useSession()
  const sync = useSync()
  const renderer = useRenderer()
  let textareaRef: TextareaRenderable | undefined

  // Dynamic textarea height: grows with content lines (min 1, max 6)
  const [lineCount, setLineCount] = createSignal(1)
  const textareaHeight = () => Math.min(Math.max(lineCount(), 1), 6)

  // Register module-level reset so clearInput() can reset height
  _resetLineCount = () => setLineCount(1)

  /** Count lines in the textarea and update the signal */
  const updateLineCount = () => {
    const text = textareaRef?.plainText ?? ""
    const newlines = text.split("\n").length
    setLineCount(newlines)
  }

  // Autocomplete dropdown state
  const [showAutocomplete, setShowAutocomplete] = createSignal(false)
  const [autocompleteItems, setAutocompleteItems] = createSignal<SlashCommand[]>([])
  const [selectedIndex, setSelectedIndex] = createSignal(0)

  // Legacy tab completion hint (kept for non-dropdown fallback)
  const [completionHint, setCompletionHint] = createSignal("")
  let tabIndex = -1
  let tabMatches: string[] = []
  let lastTabText = ""

  // No placeholder text — Claude Code style shows just "> " prompt with cursor
  const placeholder = () => ""

  const isDisabled = () =>
    session.sessionState === "WAITING_FOR_PERM" ||
    session.sessionState === "WAITING_FOR_ELIC" ||
    session.sessionState === "SHUTTING_DOWN"

  /** Dismiss the autocomplete dropdown */
  const dismissAutocomplete = () => {
    setShowAutocomplete(false)
    setAutocompleteItems([])
    setSelectedIndex(0)
  }

  /** Update autocomplete based on current input text */
  const updateAutocomplete = (text: string) => {
    // Only trigger when "/" is at position 0 with no space yet after the command
    if (!text.startsWith("/")) {
      dismissAutocomplete()
      return
    }

    // If there's a space after the command name, dismiss (command is "complete")
    const afterSlash = text.slice(1)
    if (afterSlash.includes(" ")) {
      dismissAutocomplete()
      return
    }

    const query = afterSlash
    const matches = commandRegistry.search(query)

    if (matches.length === 0) {
      dismissAutocomplete()
      return
    }

    setAutocompleteItems(matches)
    setSelectedIndex(0)
    setShowAutocomplete(true)
  }

  /** Select a command from the autocomplete dropdown */
  const selectCommand = (command: SlashCommand) => {
    setTextareaContent(`/${command.name} `)
    dismissAutocomplete()
  }

  const submit = async () => {
    if (isDisabled()) return // Don't submit when disabled
    if (!textareaRef) return
    const text = textareaRef.plainText?.trim()
    if (!text) return

    // Dismiss autocomplete on submit
    dismissAutocomplete()

    // Try slash command first
    const handled = await commandRegistry.tryExecute(text, {
      backend: agent.backend,
      pushEvent: sync.pushEvent,
      clearConversation: sync.clearConversation,
      setModel: (model: string) => agent.backend.setModel(model),
      exit: triggerCleanExit,
      getSessionState: () => ({
        cost: session.cost,
        turnNumber: session.turnNumber,
        currentModel: session.currentModel,
      }),
    })

    if (!handled) {
      // Show the user message in the conversation immediately
      sync.pushEvent({ type: "user_message", text })
      // Send to backend (queued if a turn is running)
      agent.backend.sendMessage({ text })

      // Push to history (avoid duplicating last entry) — only for real messages, not slash commands
      if (inputHistory[inputHistory.length - 1] !== text) {
        inputHistory.push(text)
      }
    }
    historyIndex = -1
    savedInput = ""

    textareaRef.clear()
    setLineCount(1)
  }

  const setTextareaContent = (text: string) => {
    if (!textareaRef) return
    textareaRef.clear()
    if (text) textareaRef.insertText(text)
  }

  const handleKeyDown = (e: KeyEvent) => {
    if (isDisabled()) return // Don't handle any keys when disabled

    // Escape = dismiss autocomplete, then completion hint, then clear input
    if (e.name === "escape") {
      e.preventDefault()
      if (showAutocomplete()) {
        dismissAutocomplete()
        // Also clear the "/" text per Claude Code behavior
        textareaRef?.clear()
        setLineCount(1)
      } else if (tabMatches.length > 0) {
        // Dismiss active tab completion
        setCompletionHint("")
        tabIndex = -1
        tabMatches = []
      } else {
        // Clear the textarea
        textareaRef?.clear()
        setLineCount(1)
        historyIndex = -1
        savedInput = ""
      }
      return
    }

    // Ctrl+A = select all text
    if (e.ctrl && e.name === "a") {
      e.preventDefault()
      textareaRef?.selectAll()
      return
    }

    // Ctrl+G = open external editor for multi-line prompt composition
    if (e.ctrl && e.name === "g") {
      e.preventDefault()
      openExternalEditor(textareaRef, renderer).then(() => {
        updateLineCount()
      })
      return
    }

    // When autocomplete is open, intercept navigation keys
    if (showAutocomplete()) {
      const items = autocompleteItems()

      // Up arrow = move selection up (wraps)
      if (e.name === "up") {
        e.preventDefault()
        const idx = selectedIndex()
        setSelectedIndex(idx <= 0 ? items.length - 1 : idx - 1)
        return
      }

      // Down arrow = move selection down (wraps)
      if (e.name === "down") {
        e.preventDefault()
        const idx = selectedIndex()
        setSelectedIndex(idx >= items.length - 1 ? 0 : idx + 1)
        return
      }

      // Enter = execute selected command
      if (e.name === "return" && !e.shift && !e.meta) {
        e.preventDefault()
        const selected = items[selectedIndex()]
        if (selected) {
          // Fill command into input and submit
          setTextareaContent(`/${selected.name}`)
          dismissAutocomplete()
          submit()
        }
        return
      }

      // Tab = fill selected command into input (without executing)
      if (e.name === "tab") {
        e.preventDefault()
        const selected = items[selectedIndex()]
        if (selected) {
          selectCommand(selected)
        }
        return
      }
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

    // Tab = slash command completion (fallback when dropdown is not showing)
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

    // Up arrow = recall previous history entry (not Ctrl+Up which scrolls conversation)
    if (e.name === "up" && !e.ctrl && inputHistory.length > 0) {
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

    // Down arrow = move forward in history (not Ctrl+Down which scrolls conversation)
    if (e.name === "down" && !e.ctrl && historyIndex !== -1) {
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

    // After the key is processed, schedule autocomplete + line count update
    // Use queueMicrotask so the textarea value reflects the keystroke
    queueMicrotask(() => {
      const text = textareaRef?.plainText ?? ""
      updateAutocomplete(text)
      updateLineCount()
    })
  }

  return (
    <box flexDirection="column">
      {/* Input row with > prompt prefix */}
      <box flexDirection="row">
        <text fg="white">{"❯ "}</text>
        <textarea
          ref={(el: TextareaRenderable) => { textareaRef = el; _sharedTextareaRef = el }}
          focused={!isDisabled()}
          height={textareaHeight()}
          placeholder={placeholder()}
          cursorStyle={{ style: "block", blinking: false }}
          keyBindings={isDisabled() ? [] : [
            { name: "return", action: "submit" },
            { name: "return", shift: true, action: "newline" },
            { name: "return", meta: true, action: "newline" },
          ]}
          onKeyDown={handleKeyDown}
          onSubmit={submit}
          flexGrow={1}
        />
        {completionHint() ? (
          <text fg="gray" attributes={TextAttributes.DIM}>
            {completionHint()}
          </text>
        ) : null}
      </box>

      {/* Autocomplete dropdown — rendered below input, no border (matches Claude Code) */}
      <Show when={showAutocomplete() && autocompleteItems().length > 0}>
        <box flexDirection="column" paddingLeft={2}>
          <For each={autocompleteItems().slice(0, MAX_VISIBLE_ITEMS)}>
            {(cmd, index) => (
              <box flexDirection="row">
                <text
                  attributes={index() === selectedIndex() ? TextAttributes.BOLD : 0}
                  fg={index() === selectedIndex() ? "cyan" : "white"}
                >
                  /{cmd.name}
                </text>
                <text fg="gray" attributes={index() !== selectedIndex() ? TextAttributes.DIM : 0}>
                  {"  \u2013  "}{cmd.description}
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}

/** Exported for testing */
export { commandRegistry }
