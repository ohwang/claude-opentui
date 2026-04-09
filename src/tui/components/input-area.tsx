/**
 * Input Area — Textarea with message submission + slash commands + file autocomplete
 *
 * Enter to send, Shift+Enter for newline.
 * Input stays enabled during RUNNING (messages queued).
 * '/' at position 0 triggers slash command autocomplete dropdown.
 * '@' anywhere triggers fuzzy file search autocomplete.
 *
 * Utilities split into:
 *   - input-utils.ts  — cursor/focus/history helpers, shared refs
 *   - command-parser.ts — shell-like command string parsing
 */

import { createSignal, createEffect, Show, Index, onCleanup } from "solid-js"
import { TextAttributes, type TextareaRenderable, type KeyEvent, type CliRenderer, decodePasteBytes } from "@opentui/core"
import { useRenderer, usePaste, useTerminalDimensions } from "@opentui/solid"
import { tmpdir } from "os"
import { join } from "path"
import { writeFileSync, readFileSync, unlinkSync } from "fs"
import { useAgent } from "../context/agent"
import { useSession } from "../context/session"
import { useSync } from "../context/sync"
import { useMessages } from "../context/messages"
import { createCommandRegistry } from "../../commands/registry"
import { executeShellCommand } from "../../commands/builtin/shell"
import { searchFiles, findLongestCommonPrefix, parsePathPrefix } from "./file-autocomplete"
import { triggerCleanExit, toggleDiagnostics } from "../app"
import { registerOverlay, unregisterOverlay } from "../context/modal"
import { colors } from "../theme/tokens"
import { friendlyBackendName } from "../models"
import { log } from "../../utils/logger"
import { readClipboard, readClipboardImage, isImageFilePath, readImageFile } from "../../utils/clipboard"
import { toast } from "../context/toast"

// Import from extracted modules
import { parseCommandString } from "./command-parser"
import {
  _cursorHidden,
  _scrollToBottom,
  setSharedTextareaRef,
  setResetLineCount,
  setUpdateLineCount,
  setAttachedImageCountSetter,
  imageAttachments,
  nextImageCounter,
  resetImageCounter,
  pasteStore,
  inputHistory,
  getHistoryIndex,
  setHistoryIndex,
  getSavedInput,
  setSavedInput,
  computeVisualLineCount,
  isSubmitKey,
  truncatePath,
  truncatePastedText,
  expandPasteRefs,
} from "./input-utils"

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

/** Discriminated union for autocomplete modes */
type AutocompleteMode = "slash" | "file" | null

/** Maximum number of items visible in the autocomplete dropdown */
const MAX_VISIBLE_ITEMS = 12

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

  try {
    const currentText = textareaRef?.plainText ?? ""
    writeFileSync(tmpFile, currentText)
    renderer.suspend()

    try {
      renderer.currentRenderBuffer.clear()
      const parts = parseCommandString(editor)
      const proc = Bun.spawn([...parts, tmpFile], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      })
      await proc.exited

      const newText = readFileSync(tmpFile, "utf-8").trimEnd()
      if (textareaRef) {
        textareaRef.clear()
        if (newText) {
          textareaRef.insertText(newText)
        }
      }
    } finally {
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

/** Helper: attach an image and insert a pill into the textarea */
function attachImage(
  image: import("../../protocol/types").ImageContent,
  textareaRef: TextareaRenderable | undefined,
  setAttachedImageCount: (n: number) => void,
  updateLineCount: () => void,
  startPasteGuard: () => void,
) {
  const imgNum = nextImageCounter()
  imageAttachments.push(image)
  setAttachedImageCount(imageAttachments.length)
  if (textareaRef) {
    startPasteGuard()
    textareaRef.insertText(`[Image #${imgNum}]`)
    updateLineCount()
  }
}

/** Helper: reset all input state after submit or shell command */
function resetInputState(
  textareaRef: TextareaRenderable,
  setLineCount: (n: number) => void,
  setAttachedImageCount: (n: number) => void,
) {
  textareaRef.clear()
  setLineCount(1)
  imageAttachments.length = 0
  resetImageCounter()
  setAttachedImageCount(0)
  pasteStore.clear()
}

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

  // Dynamic textarea height: grows with content lines (min 1, max 6)
  const [lineCount, setLineCount] = createSignal(1)
  const textareaHeight = () => Math.min(Math.max(lineCount(), 1), 6)

  // Reactive image attachment count for UI indicator
  const [attachedImageCount, setAttachedImageCount] = createSignal(0)
  setAttachedImageCountSetter(setAttachedImageCount)

  // Clear paste-guard timer on unmount to prevent leak
  onCleanup(() => clearTimeout(isPastingTimer))

  // Register module-level callbacks so exported functions can update height
  setResetLineCount(() => setLineCount(1))

  /** Count visual lines (accounting for word wrap) and update the signal */
  const updateLineCount = () => {
    const text = textareaRef?.plainText ?? ""
    const width = (dims()?.width ?? 120) - 3
    setLineCount(computeVisualLineCount(text, width))
  }

  setUpdateLineCount(updateLineCount)

  // Autocomplete dropdown state
  const [showAutocomplete, setShowAutocomplete] = createSignal(false)
  const [autocompleteItems, setAutocompleteItems] = createSignal<{ name: string; description: string; argumentHint?: string; type?: string }[]>([])
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

  // ── Paste → Enter suppression ──────────────────────────────────────
  const PASTE_GUARD_MS = 300
  let isPasting = false
  let isPastingTimer: ReturnType<typeof setTimeout> | undefined
  let lastCtrlVTime = 0

  /** Start the paste guard timer to suppress synthetic return keys */
  const startPasteGuard = () => {
    isPasting = true
    clearTimeout(isPastingTimer)
    isPastingTimer = setTimeout(() => { isPasting = false }, PASTE_GUARD_MS)
  }

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
        const matches = commandRegistry.search(query)
        if (matches.length > 0) {
          setAutocompleteItems(matches)
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
      exit: triggerCleanExit,
      toggleDiagnostics,
      getSessionState: () => ({
        cost: session.cost,
        turnNumber: session.turnNumber,
        currentModel: session.currentModel,
        currentEffort: session.currentEffort,
        session: session.session,
      }),
      getBlocks: () => messagesState.blocks,
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

  const handleKeyDown = (e: KeyEvent) => {
    if (isDisabled()) return

    _scrollToBottom?.()

    if (isPasting && e.name === "return") {
      e.preventDefault()
      return
    }

    // Ctrl+V = paste from system clipboard (try image first, fall back to text)
    if (e.ctrl && e.name === "v") {
      e.preventDefault()
      lastCtrlVTime = Date.now()

      readClipboardImage().then((result) => {
        if (result.ok) {
          if (result.resized) toast.info("Image resized to fit size limit")
          attachImage(result.image, textareaRef, setAttachedImageCount, updateLineCount, startPasteGuard)
          return
        }
        if (result.reason === "too_large") {
          toast.warn("Image too large (>5MB). Try a smaller screenshot.")
          return
        }
        return readClipboard().then(async (raw) => {
          if (!raw) return
          const text = raw.replace(/\r\n?/g, "\n")

          if (isImageFilePath(text)) {
            const img = await readImageFile(text)
            if (img) {
              attachImage(img, textareaRef, setAttachedImageCount, updateLineCount, startPasteGuard)
              toast.success(`Attached image: ${text.split("/").pop()}`)
              return
            }
          }

          const insertText = truncatePastedText(text)
          if (textareaRef) {
            startPasteGuard()
            textareaRef.insertText(insertText)
            updateLineCount()
          }
        }).catch((err) => {
          log.warn("Ctrl+V text clipboard read failed", { error: String(err) })
          sync.pushEvent({ type: "system_message", text: "Clipboard read failed — try pasting with your terminal's built-in paste", ephemeral: true })
        })
      }).catch((err) => {
        log.warn("Ctrl+V clipboard read failed", { error: String(err) })
        sync.pushEvent({ type: "system_message", text: "Clipboard read failed — try pasting with your terminal's built-in paste", ephemeral: true })
      })
      return
    }

    // Ctrl+Shift+X = clear all image attachments
    if (e.ctrl && e.shift && e.name === "x") {
      e.preventDefault()
      if (imageAttachments.length > 0) {
        imageAttachments.length = 0
        resetImageCounter()
        setAttachedImageCount(0)
        toast.info("Cleared image attachments")
        const text = textareaRef?.plainText ?? ""
        const cleaned = text.replace(/\[Image #\d+\]/g, "").trim()
        textareaRef?.clear()
        if (cleaned) textareaRef?.insertText(cleaned)
        updateLineCount()
      }
      return
    }

    // Escape = dismiss autocomplete, then completion hint, then clear input
    if (e.name === "escape") {
      e.preventDefault()
      if (showAutocomplete()) {
        const wasFile = autocompleteMode() === "file"
        dismissAutocomplete()
        if (wasFile) {
          const text = textareaRef?.plainText ?? ""
          const atMatch = text.match(/@(\S*)$/)
          if (atMatch) {
            setTextareaContent(text.slice(0, atMatch.index!))
          }
        } else {
          textareaRef?.clear()
          setLineCount(1)
        }
      } else if (tabMatches.length > 0) {
        setCompletionHint("")
        tabIndex = -1
        tabMatches = []
      } else {
        textareaRef?.clear()
        setLineCount(1)
        imageAttachments.length = 0
        resetImageCounter()
        setAttachedImageCount(0)
        pasteStore.clear()
        setHistoryIndex(-1)
        setSavedInput("")
      }
      return
    }

    // ── Emacs keybindings ──────────────────────────────────────────────

    if (e.ctrl && e.name === "a") {
      e.preventDefault()
      textareaRef?.gotoLineHome()
      return
    }

    if (e.ctrl && e.name === "e") {
      e.preventDefault()
      textareaRef?.gotoLineEnd()
      return
    }

    if (e.ctrl && e.name === "f") {
      e.preventDefault()
      textareaRef?.moveCursorRight()
      return
    }

    if (e.ctrl && !e.shift && e.name === "b") {
      e.preventDefault()
      textareaRef?.moveCursorLeft()
      return
    }

    if (e.ctrl && e.name === "n") {
      e.preventDefault()
      textareaRef?.moveCursorDown()
      return
    }

    if (e.ctrl && !e.shift && e.name === "p") {
      e.preventDefault()
      textareaRef?.moveCursorUp()
      return
    }

    if (e.ctrl && !e.shift && e.name === "d") {
      e.preventDefault()
      textareaRef?.deleteChar()
      queueMicrotask(() => { updateLineCount(); updateAutocomplete(textareaRef?.plainText ?? "") })
      return
    }

    if (e.ctrl && e.name === "h") {
      e.preventDefault()
      textareaRef?.deleteCharBackward()
      queueMicrotask(() => { updateLineCount(); updateAutocomplete(textareaRef?.plainText ?? "") })
      return
    }

    if (e.ctrl && e.name === "t") {
      e.preventDefault()
      if (!textareaRef) return
      const text = textareaRef.plainText
      const pos = textareaRef.cursorOffset
      if (pos <= 0 || text.length < 2) return
      const swapPos = pos >= text.length ? pos - 2 : pos - 1
      const chars = text.split("")
      const a = chars[swapPos]
      const b = chars[swapPos + 1]
      if (a === undefined || b === undefined) return
      chars[swapPos] = b
      chars[swapPos + 1] = a
      textareaRef.replaceText(chars.join(""))
      textareaRef.cursorOffset = swapPos + 2
      queueMicrotask(() => { updateLineCount(); updateAutocomplete(textareaRef?.plainText ?? "") })
      return
    }

    // Ctrl+K = kill to end of line (Emacs kill-line)
    // If cursor is at a newline, consume it to join with the next line (standard Emacs behavior).
    // Note: deleteToLineEnd() always returns true in OpenTUI, so check position explicitly.
    if (e.ctrl && e.name === "k") {
      e.preventDefault()
      if (textareaRef) {
        const text = textareaRef.plainText
        const offset = textareaRef.cursorOffset
        if (offset < text.length && text[offset] === "\n") {
          textareaRef.deleteChar()
        } else {
          textareaRef.deleteToLineEnd()
        }
      }
      queueMicrotask(() => { updateLineCount(); updateAutocomplete(textareaRef?.plainText ?? "") })
      return
    }

    if (e.ctrl && e.name === "u") {
      e.preventDefault()
      textareaRef?.deleteToLineStart()
      queueMicrotask(() => { updateLineCount(); updateAutocomplete(textareaRef?.plainText ?? "") })
      return
    }

    if (e.ctrl && e.name === "w") {
      e.preventDefault()
      textareaRef?.deleteWordBackward()
      queueMicrotask(() => { updateLineCount(); updateAutocomplete(textareaRef?.plainText ?? "") })
      return
    }

    if (e.ctrl && e.name === "y") {
      e.preventDefault()
      readClipboard().then((raw) => {
        if (!raw || !textareaRef) return
        const text = raw.replace(/\r\n?/g, "\n")
        textareaRef.insertText(text)
        updateLineCount()
      }).catch((err) => {
        log.warn("Ctrl+Y clipboard read failed", { error: String(err) })
      })
      return
    }

    if (e.option && e.name === "f") {
      e.preventDefault()
      textareaRef?.moveWordForward()
      return
    }

    if (e.option && e.name === "b") {
      e.preventDefault()
      textareaRef?.moveWordBackward()
      return
    }

    if (e.option && e.name === "d") {
      e.preventDefault()
      textareaRef?.deleteWordForward()
      queueMicrotask(() => { updateLineCount(); updateAutocomplete(textareaRef?.plainText ?? "") })
      return
    }

    // Ctrl+G = open external editor
    if (e.ctrl && e.name === "g") {
      e.preventDefault()
      openExternalEditor(textareaRef, renderer)
        .then(() => {
          updateLineCount()
        })
        .catch((err) => {
          log.warn("openExternalEditor promise rejected", {
            error: String(err),
          })
          sync.pushEvent({ type: "system_message", text: `External editor failed: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true })
        })
      return
    }

    // When autocomplete is open, intercept navigation keys
    if (showAutocomplete()) {
      const items = autocompleteItems()

      if (e.name === "up") {
        e.preventDefault()
        const idx = selectedIndex()
        setSelectedIndex(idx <= 0 ? items.length - 1 : idx - 1)
        return
      }

      if (e.name === "down") {
        e.preventDefault()
        const idx = selectedIndex()
        setSelectedIndex(idx >= items.length - 1 ? 0 : idx + 1)
        return
      }

      if (isSubmitKey(e)) {
        e.preventDefault()
        const selected = items[selectedIndex()]
        if (selected) {
          if (autocompleteMode() === "file") {
            selectFile(selected.name)
          } else {
            setTextareaContent(`/${selected.name}`)
            dismissAutocomplete()
            submit()
          }
        }
        return
      }

      if (e.name === "tab" && !e.shift) {
        e.preventDefault()
        if (autocompleteMode() === "file") {
          const commonPrefix = findLongestCommonPrefix(items.map((i) => i.name))
          const text = textareaRef?.plainText ?? ""
          const atMatch = text.match(/@(\S*)$/)
          const currentQuery = atMatch?.[1] ?? ""
          const cwd = agent.config.cwd ?? process.cwd()
          const { prefix: pathPrefix, fuzzyQuery } = parsePathPrefix(currentQuery, cwd)

          if (commonPrefix.length > fuzzyQuery.length) {
            const beforeAt = text.slice(0, atMatch?.index ?? text.length)
            const full = "@" + pathPrefix + commonPrefix
            setTextareaContent(beforeAt + full)
            queueMicrotask(() =>
              updateAutocomplete(beforeAt + full),
            )
            return
          }
          const selected = items[selectedIndex()]
          if (selected) selectFile(selected.name)
        } else {
          const selected = items[selectedIndex()]
          if (selected) selectCommand(selected)
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
    if (isSubmitKey(e)) {
      e.preventDefault()
      submit()
      return
    }

    // Tab = slash command completion (fallback when dropdown is not showing)
    if (e.name === "tab" && !e.shift) {
      e.preventDefault()
      const text = textareaRef?.plainText ?? ""
      if (text.startsWith("/")) {
        const query = text.slice(1).split(/\s/)[0] ?? ""

        if (lastTabText !== text || tabMatches.length === 0) {
          tabMatches = commandRegistry
            .search(query)
            .map((cmd) => `/${cmd.name}`)
          tabIndex = 0
          lastTabText = text
        } else {
          tabIndex = (tabIndex + 1) % tabMatches.length
        }

        if (tabMatches.length > 0) {
          setTextareaContent(tabMatches[tabIndex] + " ")
          const others = tabMatches
            .filter((_, i) => i !== tabIndex)
            .join("  ")
          setCompletionHint(others ? `  ${others}` : "")
        }
      }
      return
    }

    // Up arrow = recall previous history entry
    if (e.name === "up" && !e.ctrl && inputHistory.length > 0) {
      e.preventDefault()
      const hi = getHistoryIndex()
      if (hi === -1) {
        setSavedInput(textareaRef?.plainText ?? "")
        setHistoryIndex(inputHistory.length - 1)
      } else if (hi > 0) {
        setHistoryIndex(hi - 1)
      }
      setTextareaContent(inputHistory[getHistoryIndex()] ?? "")
      updateLineCount()
      return
    }

    // Down arrow = move forward in history
    if (e.name === "down" && !e.ctrl && getHistoryIndex() !== -1) {
      e.preventDefault()
      const hi = getHistoryIndex()
      if (hi < inputHistory.length - 1) {
        setHistoryIndex(hi + 1)
        setTextareaContent(inputHistory[getHistoryIndex()] ?? "")
      } else {
        setHistoryIndex(-1)
        setTextareaContent(getSavedInput())
      }
      updateLineCount()
      return
    }

    // After the key is processed, schedule autocomplete + line count update
    queueMicrotask(() => {
      const text = textareaRef?.plainText ?? ""
      updateAutocomplete(text)
      updateLineCount()
    })
  }

  return (
    <box flexDirection="column">
      {/* Image attachment indicator */}
      <Show when={attachedImageCount() > 0}>
        <box flexDirection="row" paddingLeft={2}>
          <text fg={colors.accent.primary}>
            {"\u{1F4CE} " + attachedImageCount() + " image" + (attachedImageCount() > 1 ? "s" : "") + " attached"}
          </text>
          <text fg={colors.text.inactive} attributes={TextAttributes.DIM}>
            {" \u00B7 Ctrl+Shift+X to clear"}
          </text>
        </box>
      </Show>

      {/* Input row with > prompt prefix */}
      <box flexDirection="row">
        <box width={2} flexShrink={0}>
          <text fg={isDisabled() ? colors.text.inactive : colors.text.primary} attributes={isDisabled() ? TextAttributes.DIM : 0}>{"❯"}</text>
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
          onSubmit={submit}
          flexGrow={1}
        />
        {completionHint() ? (
          <text fg={colors.text.inactive} attributes={TextAttributes.DIM}>
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
                {autocompleteMode() === "file" && (
                  <text fg={colors.text.inactive}>
                    {item().name.endsWith("/") ? "\u{1F4C1} " : "\u{1F4C4} "}
                  </text>
                )}
                <text
                  attributes={index === selectedIndex() ? TextAttributes.BOLD : 0}
                  fg={index === selectedIndex() ? colors.accent.highlight : colors.text.primary}
                >
                  {autocompleteMode() === "file" ? truncatePath(item().name) : `/${item().name}`}
                </text>
                {autocompleteMode() === "slash" && item().argumentHint && (
                  <text fg={colors.text.inactive} attributes={TextAttributes.DIM}>
                    {` ${item().argumentHint}`}
                  </text>
                )}
                {autocompleteMode() === "slash" && item().type === "prompt" && (
                  <text fg={colors.accent.highlight} attributes={TextAttributes.DIM}>
                    {" [prompt]"}
                  </text>
                )}
                <text fg={colors.text.inactive} attributes={index !== selectedIndex() ? TextAttributes.DIM : 0}>
                  {"  \u2013  "}{item().description}
                </text>
              </box>
            )}
          </Index>
          <Show when={autocompleteItems().length > MAX_VISIBLE_ITEMS}>
            <text fg={colors.text.inactive} attributes={TextAttributes.DIM}>
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
