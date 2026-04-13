/**
 * Input Area — Textarea with message submission + slash commands + file autocomplete
 *
 * Enter to send, Shift+Enter for newline.
 * Input stays enabled during RUNNING (messages queued).
 * '/' at position 0 triggers slash command autocomplete dropdown.
 * '@' anywhere triggers fuzzy file search autocomplete.
 *
 * Utilities split into:
 *   - input-utils.ts        — cursor/focus/history helpers, shared refs, pure helpers
 *   - command-parser.ts     — shell-like command string parsing
 *   - input-keybindings.ts  — key handler factory (Emacs, autocomplete, history)
 */

import { createSignal, createEffect, Show, Index, onCleanup } from "solid-js"
import { TextAttributes, type TextareaRenderable } from "@opentui/core"
import { useRenderer, usePaste, useTerminalDimensions } from "@opentui/solid"
import { decodePasteBytes } from "@opentui/core"
import { useAgent } from "../context/agent"
import { useSession } from "../context/session"
import { useSync } from "../context/sync"
import { useMessages } from "../context/messages"
import { createCommandRegistry } from "../../commands/registry"
import { executeShellCommand } from "../../commands/builtin/shell"
import { searchFiles } from "./file-autocomplete"
import { triggerCleanExit, toggleDiagnostics } from "../app"
import { registerOverlay, unregisterOverlay } from "../context/modal"
import { colors } from "../theme/tokens"
import { friendlyBackendName } from "../models"
import { log } from "../../utils/logger"
import { readClipboardImage, isImageFilePath, readImageFile } from "../../utils/clipboard"
import { toast } from "../context/toast"

// Import from extracted modules
import {
  _cursorHidden,
  setSharedTextareaRef,
  setResetLineCount,
  setUpdateLineCount,
  setAttachedImageCountSetter,
  imageAttachments,
  inputHistory,
  setHistoryIndex,
  setSavedInput,
  computeVisualLineCount,
  truncatePath,
  truncatePastedText,
  expandPasteRefs,
  attachImage,
  resetInputState,
} from "./input-utils"

import { createKeyHandler, type AutocompleteMode, type AutocompleteItem } from "./input-keybindings"

// Re-export everything that external files import from input-area
export {
  clearInput,
  refocusInput,
  blurInput,
  hideCursor,
  showCursor,
  isCursorHidden,
  registerScrollToBottom,
  hasInputText,
  getInputHistory,
  setInputText,
  getImageAttachmentCount,
  clearImageAttachments,
  computeVisualLineCount,
  isSubmitKey,
} from "./input-utils"

export { parseCommandString } from "./command-parser"

const commandRegistry = createCommandRegistry()

/** Maximum number of items visible in the autocomplete dropdown */
const MAX_VISIBLE_ITEMS = 12

export function InputArea() {
  const agent = useAgent()
  const { state: session } = useSession()
  const sync = useSync()
  const { state: messagesState } = useMessages()
  const renderer = useRenderer()
  const dims = useTerminalDimensions()
  let textareaRef: TextareaRenderable | undefined

  // Debounce timer for expensive file autocomplete searches
  let fileSearchTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(fileSearchTimer))

  // Dynamic textarea height: grows with content lines (min 1, max 20)
  const MAX_TEXTAREA_LINES = 20
  const [lineCount, setLineCount] = createSignal(1)
  const textareaHeight = () => Math.min(Math.max(lineCount(), 1), MAX_TEXTAREA_LINES)

  // Tracks textarea scroll offset so we can show a "hidden above" indicator
  // when content exceeds the visible cap and the viewport has scrolled down.
  const [scrollOffset, setScrollOffset] = createSignal(0)
  const refreshScrollOffset = () => {
    const y = textareaRef?.scrollY ?? 0
    setScrollOffset(y > 0 ? y : 0)
  }

  // Reactive image attachment count for UI indicator
  const [attachedImageCount, setAttachedImageCount] = createSignal(0)
  setAttachedImageCountSetter(setAttachedImageCount)

  // ── Paste guard state ──────────────────────────────────────────────
  const PASTE_GUARD_MS = 300
  let isPasting = false
  let isPastingTimer: ReturnType<typeof setTimeout> | undefined
  let lastCtrlVTime = 0
  onCleanup(() => clearTimeout(isPastingTimer))

  /** Start the paste guard timer to suppress synthetic return keys */
  const startPasteGuard = () => {
    isPasting = true
    clearTimeout(isPastingTimer)
    isPastingTimer = setTimeout(() => { isPasting = false }, PASTE_GUARD_MS)
  }

  // Register module-level callbacks so exported functions can update height
  setResetLineCount(() => {
    setLineCount(1)
    setScrollOffset(0)
  })

  /** Count visual lines (accounting for word wrap) and update the signal */
  const updateLineCount = () => {
    const text = textareaRef?.plainText ?? ""
    const width = (dims()?.width ?? 120) - 3
    setLineCount(computeVisualLineCount(text, width))
    refreshScrollOffset()
  }

  setUpdateLineCount(updateLineCount)

  // Autocomplete dropdown state
  const [showAutocomplete, setShowAutocomplete] = createSignal(false)
  const [autocompleteItems, setAutocompleteItems] = createSignal<AutocompleteItem[]>([])
  const [selectedIndex, setSelectedIndex] = createSignal(0)
  const [autocompleteMode, setAutocompleteMode] = createSignal<AutocompleteMode>(null)

  // Register autocomplete dropdown as an overlay for escape coordination
  createEffect(() => {
    if (showAutocomplete()) {
      registerOverlay("autocomplete")
    } else {
      unregisterOverlay("autocomplete")
    }
  })

  // Legacy tab completion hint (kept for non-dropdown fallback)
  const [completionHint, setCompletionHint] = createSignal("")
  let tabIndex = -1
  let tabMatches: string[] = []
  let lastTabText = ""

  // ── Paste deduplication ────────────────────────────────────────────
  let lastPasteText = ""
  let lastPasteTime = 0
  const PASTE_DEDUP_MS = 150

  usePaste((event) => {
    event.preventDefault()

    const now = Date.now()
    if (now - lastCtrlVTime < 500) {
      log.debug("Suppressed bracket-paste after Ctrl+V", { ms: now - lastCtrlVTime })
      return
    }

    const raw = decodePasteBytes(event.bytes)
    if (!raw) {
      readClipboardImage().then((result) => {
        if (result.ok) {
          if (result.resized) toast.info("Image resized to fit size limit")
          attachImage(result.image, textareaRef, setAttachedImageCount, updateLineCount, startPasteGuard)
        } else if (result.reason === "too_large") {
          toast.warn("Image too large (>5MB). Try a smaller screenshot.")
        }
      }).catch((err) => {
        log.warn("Empty paste image check failed", { error: String(err) })
      })
      return
    }

    const text = raw.replace(/\r\n?/g, "\n")

    if (text === lastPasteText && now - lastPasteTime < PASTE_DEDUP_MS) {
      log.debug("Suppressed duplicate paste event", { length: text.length })
      return
    }

    lastPasteText = text
    lastPasteTime = now

    if (isImageFilePath(text)) {
      readImageFile(text).then((img) => {
        if (img) {
          attachImage(img, textareaRef, setAttachedImageCount, updateLineCount, startPasteGuard)
          toast.success(`Attached image: ${text.split("/").pop()}`)
          return
        }
        insertPastedText(text)
      }).catch(() => {
        insertPastedText(text)
      })
      return
    }

    insertPastedText(text)

    function insertPastedText(t: string) {
      const truncated = truncatePastedText(t)
      if (textareaRef) {
        startPasteGuard()
        textareaRef.insertText(truncated)
        updateLineCount()
      }
    }
  })

  // Context-aware placeholder hints — stop showing after a few turns
  let hintShownCount = 0
  const MAX_HINT_SHOWS = 5

  const placeholder = () => {
    if (session.resuming) return "Loading session history…"
    if (session.sessionState === "INITIALIZING") return "Type a message to start..."
    if (session.sessionState === "RUNNING") return "Type to queue a message..."
    if (session.sessionState === "WAITING_FOR_PERM") return ""
    if (session.sessionState === "WAITING_FOR_ELIC") return ""

    if (hintShownCount >= MAX_HINT_SHOWS) return ""
    hintShownCount++

    const blocks = messagesState.blocks
    if (blocks.length === 0) {
      return `Ask ${friendlyBackendName(agent.backend.capabilities().name)} anything, or use / for commands`
    }
    return ""
  }

  const isDisabled = () =>
    session.resuming ||
    session.sessionState === "WAITING_FOR_PERM" ||
    session.sessionState === "WAITING_FOR_ELIC" ||
    session.sessionState === "SHUTTING_DOWN"

  const dismissAutocomplete = () => {
    setShowAutocomplete(false)
    setAutocompleteItems([])
    setSelectedIndex(0)
    setAutocompleteMode(null)
  }

  const updateAutocomplete = (text: string) => {
    const atMatch = text.match(/@(\S*)$/)
    if (atMatch) {
      const query = atMatch[1] ?? ""
      const cwd = agent.config.cwd ?? process.cwd()
      clearTimeout(fileSearchTimer)
      fileSearchTimer = setTimeout(() => {
        const files = searchFiles(query, cwd, MAX_VISIBLE_ITEMS)
        if (files.length > 0) {
          setAutocompleteItems(files.map((f) => ({
            name: f,
            description: f.endsWith("/") ? "directory" : "file",
          })))
          setSelectedIndex(0)
          setAutocompleteMode("file")
          setShowAutocomplete(true)
        } else {
          dismissAutocomplete()
        }
      }, 100)
      return
    }

    if (text.startsWith("/")) {
      const afterSlash = text.slice(1)
      if (!afterSlash.includes(" ")) {
        const query = afterSlash
        const builtinMatches = commandRegistry.search(query)

        // Merge agent-advertised commands (from ACP available_commands_update)
        const agentCmds = session.agentCommands ?? []
        const agentMatches = agentCmds
          .filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
          .map((c) => ({
            name: c.name,
            description: c.description ?? `${friendlyBackendName(agent.backend.capabilities().name)} command`,
          }))

        // Deduplicate: built-in commands take precedence
        const builtinNames = new Set(builtinMatches.map((c) => c.name))
        const uniqueAgentMatches = agentMatches.filter((c) => !builtinNames.has(c.name))

        const allMatches = [...builtinMatches, ...uniqueAgentMatches]
        if (allMatches.length > 0) {
          setAutocompleteItems(allMatches)
          setSelectedIndex(0)
          setAutocompleteMode("slash")
          setShowAutocomplete(true)
          return
        }
      }
    }

    dismissAutocomplete()
  }

  const selectCommand = (command: { name: string }) => {
    setTextareaContent(`/${command.name} `)
    dismissAutocomplete()
  }

  const selectFile = (filePath: string) => {
    const text = textareaRef?.plainText ?? ""
    const atMatch = text.match(/@(\S*)$/)
    if (atMatch) {
      const query = atMatch[1] ?? ""
      // Preserve the path prefix (e.g. "../src/", "~/dev/") the user typed
      const lastSlash = query.lastIndexOf("/")
      const prefix = lastSlash >= 0 ? query.slice(0, lastSlash + 1) : ""
      const beforeAt = text.slice(0, atMatch.index!)
      setTextareaContent(beforeAt + prefix + filePath + " ")
    } else {
      setTextareaContent(text + filePath + " ")
    }
    dismissAutocomplete()
  }

  const submit = async () => {
    if (isDisabled()) return
    if (!textareaRef) return
    let text = expandPasteRefs(textareaRef.plainText?.trim() ?? "")
    if (!text) return

    dismissAutocomplete()

    // Shell command: ! prefix runs command in bash
    if (text.startsWith("!")) {
      const cmd = text.slice(1).trim()
      if (cmd) {
        const cwd = agent.config.cwd ?? process.cwd()
        executeShellCommand(cmd, sync.pushEvent, cwd)
        if (inputHistory[inputHistory.length - 1] !== text) {
          inputHistory.push(text)
        }
        setHistoryIndex(-1)
        setSavedInput("")
        resetInputState(textareaRef, setLineCount, setAttachedImageCount)
        return
      }
    }

    const handled = await commandRegistry.tryExecute(text, {
      backend: agent.backend,
      pushEvent: sync.pushEvent,
      clearConversation: sync.clearConversation,
      resetCost: sync.resetCost,
      resetSession: async () => { await agent.backend.resetSession?.() },
      setModel: (model: string) => agent.backend.setModel(model),
      switchBackend: (opts) => sync.switchBackend(opts),
      exit: triggerCleanExit,
      toggleDiagnostics,
      getSessionState: () => ({
        cost: session.cost,
        turnNumber: session.turnNumber,
        currentModel: session.currentModel,
        currentEffort: session.currentEffort,
        session: session.session,
        configOptions: session.configOptions,
        sessionState: session.sessionState,
      }),
      getBlocks: () => messagesState.blocks,
      getCwd: () => agent.config.cwd ?? process.cwd(),
      renderer,
    })

    if (!handled) {
      const images = imageAttachments.length > 0 ? [...imageAttachments] : undefined
      sync.pushEvent({ type: "user_message", text, images })
      agent.backend.sendMessage({ text, images })

      if (inputHistory[inputHistory.length - 1] !== text) {
        inputHistory.push(text)
      }
    }
    setHistoryIndex(-1)
    setSavedInput("")
    resetInputState(textareaRef, setLineCount, setAttachedImageCount)
  }

  const setTextareaContent = (text: string) => {
    if (!textareaRef) return
    textareaRef.clear()
    if (text) textareaRef.insertText(text)
  }

  // ── Key handler (logic lives in input-keybindings.ts) ──────────────

  const mutableState = {
    get isPasting() { return isPasting },
    set isPasting(v: boolean) { isPasting = v },
    get isPastingTimer() { return isPastingTimer },
    set isPastingTimer(v: ReturnType<typeof setTimeout> | undefined) { isPastingTimer = v },
    get lastCtrlVTime() { return lastCtrlVTime },
    set lastCtrlVTime(v: number) { lastCtrlVTime = v },
    get tabIndex() { return tabIndex },
    set tabIndex(v: number) { tabIndex = v },
    get tabMatches() { return tabMatches },
    set tabMatches(v: string[]) { tabMatches = v },
    get lastTabText() { return lastTabText },
    set lastTabText(v: string) { lastTabText = v },
  }

  const handleKeyDown = createKeyHandler(
    {
      isDisabled,
      showAutocomplete,
      autocompleteItems,
      autocompleteMode,
      selectedIndex,
      setSelectedIndex,
      setCompletionHint,
      setLineCount,
      setAttachedImageCount,
    },
    mutableState,
    {
      getTextareaRef: () => textareaRef,
      updateLineCount,
      updateAutocomplete,
      dismissAutocomplete,
      setTextareaContent,
      selectFile,
      selectCommand,
      submit,
      startPasteGuard,
      pushEvent: sync.pushEvent,
      searchCommands: (query: string) => commandRegistry.search(query),
      getCwd: () => agent.config.cwd ?? process.cwd(),
      getBlocks: () => messagesState.blocks,
    },
    renderer,
  )

  return (
    <box flexDirection="column">
      {/* Image attachment indicator */}
      <Show when={attachedImageCount() > 0}>
        <box flexDirection="row" paddingLeft={2}>
          <text fg={colors.accent.primary}>
            {"\u{1F4CE} " + attachedImageCount() + " image" + (attachedImageCount() > 1 ? "s" : "") + " attached"}
          </text>
          <text fg={colors.text.muted}>
            {" \u00B7 Ctrl+Shift+X to clear"}
          </text>
        </box>
      </Show>

      {/* Overflow indicator: earlier lines are hidden above the viewport */}
      <Show when={scrollOffset() > 0}>
        <box flexDirection="row" paddingLeft={2}>
          <text fg={colors.text.muted} attributes={TextAttributes.DIM}>
            {`\u25B2 ${scrollOffset()} line${scrollOffset() === 1 ? "" : "s"} hidden above`}
          </text>
        </box>
      </Show>

      {/* Input row with > prompt prefix */}
      <box flexDirection="row">
        <box width={2} flexShrink={0}>
          <text fg={isDisabled() ? colors.text.muted : colors.text.primary}>{"❯"}</text>
        </box>
        <textarea
          ref={(el: TextareaRenderable) => { textareaRef = el; setSharedTextareaRef(el) }}
          focused={!isDisabled() && !_cursorHidden}
          height={textareaHeight()}
          placeholder={placeholder()}
          cursorStyle={{ style: "block", blinking: false }}
          keyBindings={isDisabled() ? [] : [
            { name: "return", action: "submit" },
            { name: "return", shift: true, action: "newline" },
            { name: "return", meta: true, action: "newline" },
          ]}
          onKeyDown={handleKeyDown}
          onCursorChange={refreshScrollOffset}
          onContentChange={refreshScrollOffset}
          onSubmit={submit}
          flexGrow={1}
        />
        {completionHint() ? (
          <text fg={colors.text.muted}>
            {completionHint()}
          </text>
        ) : null}
      </box>

      {/* Autocomplete dropdown — rendered below input, no border (matches Claude Code) */}
      <Show when={showAutocomplete() && autocompleteItems().length > 0}>
        <box flexDirection="column" paddingLeft={2}>
          <Index each={autocompleteItems().slice(0, MAX_VISIBLE_ITEMS)}>
            {(item, index) => (
              <box flexDirection="row">
                <text
                  attributes={index === selectedIndex() ? TextAttributes.BOLD : 0}
                  fg={index === selectedIndex() ? colors.accent.highlight : colors.text.primary}
                >
                  {autocompleteMode() === "file" ? truncatePath(item().name) : `/${item().name}`}
                </text>
                {autocompleteMode() === "slash" && item().argumentHint && (
                  <text fg={colors.text.muted}>
                    {` ${item().argumentHint}`}
                  </text>
                )}
                {autocompleteMode() === "slash" && item().type === "prompt" && (
                  <text fg={colors.accent.highlight} attributes={TextAttributes.DIM}>
                    {" [prompt]"}
                  </text>
                )}
                <text fg={colors.text.secondary} attributes={index !== selectedIndex() ? TextAttributes.DIM : 0}>
                  {"  \u2013  "}{item().description}
                </text>
              </box>
            )}
          </Index>
          <Show when={autocompleteItems().length > MAX_VISIBLE_ITEMS}>
            <text fg={colors.text.muted}>
              {`  ${autocompleteItems().length - MAX_VISIBLE_ITEMS} more...`}
            </text>
          </Show>
        </box>
      </Show>
    </box>
  )
}

/** Exported for testing */
export { commandRegistry }
