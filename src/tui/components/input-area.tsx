/**
 * Input Area — Textarea with message submission + slash commands + file autocomplete
 *
 * Enter to send, Shift+Enter for newline.
 * Input stays enabled during RUNNING (messages queued).
 * '/' at position 0 triggers slash command autocomplete dropdown.
 * '@' anywhere triggers fuzzy file search autocomplete.
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
import { searchFiles, findLongestCommonPrefix } from "./file-autocomplete"
import { triggerCleanExit, toggleDiagnostics } from "../app"
import { registerOverlay, unregisterOverlay } from "../context/modal"
import { colors } from "../theme/tokens"
import { log } from "../../utils/logger"
import { readClipboard, readClipboardImage, isImageFilePath, readImageFile } from "../../utils/clipboard"
import { toast } from "../context/toast"
import type { ImageContent } from "../../protocol/types"

const commandRegistry = createCommandRegistry()

/**
 * Calculate the number of visual lines a text occupies given a column width.
 * Used to set the textarea height — must match the textarea's actual wrapping.
 *
 * @param text - The raw text content
 * @param availableWidth - The textarea's column width (terminal width minus prefix and padding)
 * @returns Number of visual lines (minimum 1)
 */
export function computeVisualLineCount(text: string, availableWidth: number): number {
  const width = Math.max(availableWidth, 1)
  let totalLines = 0
  for (const line of text.split("\n")) {
    totalLines += Math.max(1, Math.ceil(line.length / width))
  }
  return totalLines
}

/** Plain Enter submits; Shift+Enter / Cmd+Enter insert a newline instead. */
export function isSubmitKey(event: Pick<KeyEvent, "name" | "shift" | "meta" | "super">): boolean {
  return event.name === "return" && !event.shift && !event.meta && !event.super
}

/** Truncate a file path to fit the terminal, showing the tail end */
function truncatePath(path: string, maxLen: number = 70): string {
  if (path.length <= maxLen) return path
  return "..." + path.slice(-(maxLen - 3))
}

/**
 * If text exceeds PASTE_TRUNCATION_THRESHOLD, store the full content in
 * pasteStore and return a truncated preview with a reference marker.
 * Otherwise return the text unchanged.
 */
function truncatePastedText(text: string): string {
  if (text.length <= PASTE_TRUNCATION_THRESHOLD) return text

  pasteRefCounter++
  const refNum = pasteRefCounter
  pasteStore.set(refNum, text)

  const lineCount = text.split("\n").length
  const preview = text.slice(0, PASTE_PREVIEW_LENGTH)
  const truncatedLines = lineCount - preview.split("\n").length
  const marker = `\n[...Pasted text #${refNum}: +${truncatedLines} more lines, ${text.length.toLocaleString()} chars total...]`

  log.info("Large paste truncated", { refNum, chars: text.length, lines: lineCount })
  toast.info(`Large paste stored as ref #${refNum} (${text.length.toLocaleString()} chars)`, 4000)

  return preview + marker
}

/**
 * Expand paste reference markers in message text back to the full pasted
 * content before sending to the backend.  Each marker has the form:
 *   [...Pasted text #N: +M more lines, C chars total...]
 * The preview text preceding it (first 500 chars of the paste) is kept;
 * the marker is replaced with the remaining content.
 */
function expandPasteRefs(text: string): string {
  let expanded = text
  for (const [refNum, fullContent] of pasteStore.entries()) {
    // The marker regex — match the [...Pasted text #N: ...] block
    const markerRegex = new RegExp(`\\[\\.\\.\\.Pasted text #${refNum}:[^\\]]*\\]`)
    if (markerRegex.test(expanded)) {
      // The preview (first PASTE_PREVIEW_LENGTH chars) is already in the text
      // before the marker. Replace the marker with the remaining content.
      expanded = expanded.replace(markerRegex, fullContent.slice(PASTE_PREVIEW_LENGTH))
    }
  }
  return expanded
}

/** Discriminated union for autocomplete modes */
type AutocompleteMode = "slash" | "file" | null

/** Maximum number of items visible in the autocomplete dropdown */
const MAX_VISIBLE_ITEMS = 12

// Smart paste truncation: store full content, show preview + reference in textarea
const PASTE_TRUNCATION_THRESHOLD = 10_000
const PASTE_PREVIEW_LENGTH = 500
const pasteStore = new Map<number, string>()
let pasteRefCounter = 0

// Input history for Up/Down arrow recall
const inputHistory: string[] = []
let historyIndex = -1
let savedInput = ""

// Image attachments for current message (cleared on submit)
let imageAttachments: ImageContent[] = []
let imageCounter = 0

/** Module-level setter so exported functions can update the reactive signal */
let _setAttachedImageCount: ((n: number) => void) | undefined

/** Get the current number of attached images */
export function getImageAttachmentCount(): number {
  return imageAttachments.length
}

/** Clear all image attachments */
export function clearImageAttachments(): void {
  imageAttachments = []
  imageCounter = 0
  _setAttachedImageCount?.(0)
}

/**
 * Clear the input area text. Called by the global Ctrl+C handler in Layout
 * when the session is IDLE.
 * Returns true if there was text to clear, false if already empty.
 */
export function clearInput(): boolean {
  if (!_sharedTextareaRef) return false
  const text = _sharedTextareaRef.plainText?.trim()
  if (!text && imageAttachments.length === 0) return false
  _sharedTextareaRef.clear()
  _resetLineCount?.()
  imageAttachments = []
  pasteStore.clear()
  return true
}

/**
 * Re-focus the textarea. Called after scroll or any event that may have
 * shifted OpenTUI focus away from the input area.
 *
 * In native Claude Code the textarea always captures keyboard input —
 * the user can scroll up to read history, then just start typing.
 * This function ensures the same behavior by reclaiming focus.
 *
 * Only reclaims focus when the cursor is not intentionally hidden.
 */
export function refocusInput(): void {
  if (!_cursorHidden) {
    _sharedTextareaRef?.focus()
  }
}

/**
 * Blur the textarea so the cursor disappears.
 * Called when the user scrolls away from the input area (Ctrl+Up).
 */
export function blurInput(): void {
  _sharedTextareaRef?.blur()
}

// ---------------------------------------------------------------------------
// Cursor visibility — single source of truth
// ---------------------------------------------------------------------------
// The textarea shows a cursor whenever it has focus. Rather than fighting
// between the reactive `focused` prop and imperative `.blur()`/`.focus()`
// calls, we track intent via a module-level flag that the `focused` prop
// reads. `hideCursor()` / `showCursor()` toggle this flag AND immediately
// call `.blur()`/`.focus()` for instant effect.
// ---------------------------------------------------------------------------
let _cursorHidden = false

/**
 * Hide the textarea cursor. The textarea remains mounted but loses focus
 * so the terminal cursor disappears. Keyboard events still reach
 * useKeyboard() handlers — only text insertion is paused.
 */
export function hideCursor(): void {
  _cursorHidden = true
  _sharedTextareaRef?.blur()
}

/**
 * Show the textarea cursor. Restores focus so text insertion and the
 * terminal cursor both work again.
 */
export function showCursor(): void {
  _cursorHidden = false
  _sharedTextareaRef?.focus()
}

/** Whether the cursor is intentionally hidden. */
export function isCursorHidden(): boolean {
  return _cursorHidden
}

/**
 * Register a callback to scroll the viewport to bottom.
 * Called by ConversationView to avoid circular imports.
 */
let _scrollToBottom: (() => void) | undefined
export function registerScrollToBottom(fn: () => void): void {
  _scrollToBottom = fn
}

/**
 * Check whether the input textarea currently has non-whitespace text.
 * Used by the Ctrl+D handler to only trigger exit when the editor is empty.
 */
export function hasInputText(): boolean {
  if (!_sharedTextareaRef) return false
  return Boolean(_sharedTextareaRef.plainText?.trim())
}

/** Module-level ref so clearInput() can access the textarea */
let _sharedTextareaRef: TextareaRenderable | undefined
/** Module-level callback to reset line count when clearInput() is called externally */
let _resetLineCount: (() => void) | undefined

/**
 * Parse a shell-like command string into argv, preserving quoted segments.
 * Needed for editor commands such as:
 *   /Applications/Visual Studio Code.app/.../code --wait
 *   open -a "Visual Studio Code" --wait-apps
 */
export function parseCommandString(command: string): string[] {
  const input = command.trim()
  if (!input) return []

  const args: string[] = []
  let current = ""
  let quote: "'" | '"' | null = null
  let escaped = false

  for (const ch of input) {
    if (escaped) {
      current += ch
      escaped = false
      continue
    }

    if (ch === "\\" && quote !== "'") {
      escaped = true
      continue
    }

    if (ch === "'" || ch === "\"") {
      if (quote === ch) {
        quote = null
      } else if (quote === null) {
        quote = ch
      } else {
        current += ch
      }
      continue
    }

    if (!quote && /\s/.test(ch)) {
      if (current) {
        args.push(current)
        current = ""
      }
      continue
    }

    current += ch
  }

  if (escaped) current += "\\"
  if (current) args.push(current)
  return args
}

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
    // Write current input to temp file (inside try so finally always cleans up)
    const currentText = textareaRef?.plainText ?? ""
    writeFileSync(tmpFile, currentText)
    // Suspend TUI rendering so the editor can take over the terminal
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
  _setAttachedImageCount = setAttachedImageCount

  // Clear paste-guard timer on unmount to prevent leak
  onCleanup(() => clearTimeout(isPastingTimer))

  // Register module-level reset so clearInput() can reset height
  _resetLineCount = () => setLineCount(1)

  /** Count visual lines (accounting for word wrap) and update the signal */
  const updateLineCount = () => {
    const text = textareaRef?.plainText ?? ""
    // Available width = terminal width - prefix box (2 cols) - scrollbox paddingRight (1)
    const width = (dims()?.width ?? 120) - 3
    setLineCount(computeVisualLineCount(text, width))
  }

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
  // OpenTUI's bracket-paste handling can fire multiple times for a single
  // tmux paste (observed as 4× duplication). We intercept paste events at
  // the global level (usePaste fires before renderable handlers), call
  // preventDefault() to suppress the built-in handling, then do a single
  // insertText ourselves. A short dedup window guards against any
  // remaining rapid-fire duplicates.
  let lastPasteText = ""
  let lastPasteTime = 0
  const PASTE_DEDUP_MS = 150

  // ── Paste → Enter suppression ──────────────────────────────────────
  // When multi-line text is pasted, the terminal's stdin parser may
  // interpret each \n byte as a separate "return" key event *after* the
  // bracket-paste sequence is handled.  preventDefault() on the
  // PasteEvent stops OpenTUI's built-in insert, but it cannot prevent
  // the stdin parser from emitting those synthetic keystrokes.
  //
  // We set `isPasting` while the paste is being processed and clear it
  // after a short timer.  handleKeyDown checks this flag and
  // suppresses "return" → submit so that newlines in pasted text stay
  // as newlines instead of triggering message submission.
  const PASTE_GUARD_MS = 300
  let isPasting = false
  let isPastingTimer: ReturnType<typeof setTimeout> | undefined
  let lastCtrlVTime = 0

  usePaste((event) => {
    // Always suppress OpenTUI's default textarea paste handling
    event.preventDefault()

    // If we just handled Ctrl+V, the bracket-paste event is a duplicate
    const now = Date.now()
    if (now - lastCtrlVTime < 500) {
      log.debug("Suppressed bracket-paste after Ctrl+V", { ms: now - lastCtrlVTime })
      return
    }

    const raw = decodePasteBytes(event.bytes)
    if (!raw) {
      // Empty paste could mean clipboard has image, not text
      // (macOS terminal behavior — sends empty bracket paste for image clipboard)
      readClipboardImage().then((result) => {
        if (result.ok) {
          if (result.resized) toast.info("Image resized to fit size limit")
          imageCounter++
          imageAttachments.push(result.image)
          setAttachedImageCount(imageAttachments.length)
          if (textareaRef) {
            isPasting = true
            textareaRef.insertText(`[Image #${imageCounter}]`)
            updateLineCount()
            clearTimeout(isPastingTimer)
            isPastingTimer = setTimeout(() => { isPasting = false }, PASTE_GUARD_MS)
          }
        } else if (result.reason === "too_large") {
          toast.warn("Image too large (>5MB). Try a smaller screenshot.")
        }
      }).catch((err) => {
        log.warn("Empty paste image check failed", { error: String(err) })
      })
      return
    }

    // Normalize line endings: terminal pastes often use \r\n or bare \r
    // instead of \n.  The textarea only recognizes \n as a newline, so
    // without normalization multi-line pastes collapse onto one line.
    const text = raw.replace(/\r\n?/g, "\n")

    // Deduplicate identical pastes arriving within the window
    if (text === lastPasteText && now - lastPasteTime < PASTE_DEDUP_MS) {
      log.debug("Suppressed duplicate paste event", { length: text.length })
      return
    }

    lastPasteText = text
    lastPasteTime = now

    // Check if pasted text is a path to an image file
    if (isImageFilePath(text)) {
      readImageFile(text).then((img) => {
        if (img) {
          imageCounter++
          imageAttachments.push(img)
          if (textareaRef) {
            isPasting = true
            textareaRef.insertText(`[Image #${imageCounter}]`)
            updateLineCount()
            clearTimeout(isPastingTimer)
            isPastingTimer = setTimeout(() => { isPasting = false }, PASTE_GUARD_MS)
          }
          toast.success(`Attached image: ${text.split("/").pop()}`)
          return
        }
        // File didn't exist or couldn't be read — fall through to text paste
        insertPastedText(text)
      }).catch(() => {
        insertPastedText(text)
      })
      return
    }

    insertPastedText(text)

    function insertPastedText(t: string) {
      // Smart paste truncation for large pastes
      const truncated = truncatePastedText(t)
      if (textareaRef) {
        isPasting = true
        textareaRef.insertText(truncated)
        updateLineCount()
        clearTimeout(isPastingTimer)
        isPastingTimer = setTimeout(() => { isPasting = false }, PASTE_GUARD_MS)
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

    // IDLE state — show progressive hints (only first few times)
    if (hintShownCount >= MAX_HINT_SHOWS) return ""
    hintShownCount++

    const blocks = messagesState.blocks
    if (blocks.length === 0) {
      return "Ask Claude anything, or use / for commands"
    }
    return ""
  }

  const isDisabled = () =>
    session.sessionState === "WAITING_FOR_PERM" ||
    session.sessionState === "WAITING_FOR_ELIC" ||
    session.sessionState === "SHUTTING_DOWN"

  /** Dismiss the autocomplete dropdown */
  const dismissAutocomplete = () => {
    setShowAutocomplete(false)
    setAutocompleteItems([])
    setSelectedIndex(0)
    setAutocompleteMode(null)
  }

  /** Update autocomplete based on current input text */
  const updateAutocomplete = (text: string) => {
    // Check for @file trigger: "@" followed by non-whitespace at any position
    const atMatch = text.match(/@(\S*)$/)
    if (atMatch) {
      const query = atMatch[1] ?? ""
      const cwd = agent.config.cwd ?? process.cwd()
      // Debounce file search — it's expensive (fuzzy match over directory tree).
      // Slash command search below is cheap, so only file search is debounced.
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

    // Check for /slash command trigger at position 0
    if (text.startsWith("/")) {
      // If there's a space after the command name, dismiss (command is "complete")
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

  /** Select a command from the autocomplete dropdown */
  const selectCommand = (command: { name: string }) => {
    setTextareaContent(`/${command.name} `)
    dismissAutocomplete()
  }

  /** Select a file from the autocomplete dropdown — replaces @query with the path */
  const selectFile = (filePath: string) => {
    const text = textareaRef?.plainText ?? ""
    const atMatch = text.match(/@(\S*)$/)
    if (atMatch) {
      const beforeAt = text.slice(0, atMatch.index!)
      setTextareaContent(beforeAt + filePath + " ")
    } else {
      // Fallback: just append
      setTextareaContent(text + filePath + " ")
    }
    dismissAutocomplete()
  }

  const submit = async () => {
    if (isDisabled()) return // Don't submit when disabled
    if (!textareaRef) return
    // Expand paste references back to full content before sending
    let text = expandPasteRefs(textareaRef.plainText?.trim() ?? "")
    if (!text) return

    // Dismiss autocomplete on submit
    dismissAutocomplete()

    // Shell command: ! prefix runs command in bash
    if (text.startsWith("!")) {
      const cmd = text.slice(1).trim()
      if (cmd) {
        const cwd = agent.config.cwd ?? process.cwd()
        // Don't await — let it run async (tool_use_start shows immediately)
        executeShellCommand(cmd, sync.pushEvent, cwd)
        // Add to input history
        if (inputHistory[inputHistory.length - 1] !== text) {
          inputHistory.push(text)
        }
        historyIndex = -1
        savedInput = ""
        textareaRef.clear()
        setLineCount(1)
        imageAttachments = []
        imageCounter = 0
        setAttachedImageCount(0)
        pasteStore.clear()
        return
      }
    }

    // Try slash command first
    const handled = await commandRegistry.tryExecute(text, {
      backend: agent.backend,
      pushEvent: sync.pushEvent,
      clearConversation: sync.clearConversation,
      resetCost: sync.resetCost,
      setModel: (model: string) => agent.backend.setModel(model),
      exit: triggerCleanExit,
      toggleDiagnostics,
      getSessionState: () => ({
        cost: session.cost,
        turnNumber: session.turnNumber,
        currentModel: session.currentModel,
        session: session.session,
      }),
      getBlocks: () => messagesState.blocks,
      renderer,
    })

    if (!handled) {
      // Capture and clear image attachments before sending
      const images = imageAttachments.length > 0 ? [...imageAttachments] : undefined
      // Show the user message in the conversation immediately
      sync.pushEvent({ type: "user_message", text, images })
      // Send to backend (queued if a turn is running)
      agent.backend.sendMessage({ text, images })

      // Push to history (avoid duplicating last entry) — only for real messages, not slash commands
      if (inputHistory[inputHistory.length - 1] !== text) {
        inputHistory.push(text)
      }
    }
    historyIndex = -1
    savedInput = ""

    textareaRef.clear()
    setLineCount(1)
    imageAttachments = []
    imageCounter = 0
    setAttachedImageCount(0)
    pasteStore.clear()
  }

  const setTextareaContent = (text: string) => {
    if (!textareaRef) return
    textareaRef.clear()
    if (text) textareaRef.insertText(text)
  }

  const handleKeyDown = (e: KeyEvent) => {
    if (isDisabled()) return // Don't handle any keys when disabled

    // Ensure the viewport is scrolled to bottom when the user types,
    // so the textarea is always visible even if they scrolled up to read.
    _scrollToBottom?.()

    // During a paste, the stdin parser may emit \n bytes as "return"
    // key events.  Suppress them so pasted newlines don't trigger submit.
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
          // Image found — add as attachment and insert pill
          if (result.resized) toast.info("Image resized to fit size limit")
          imageCounter++
          imageAttachments.push(result.image)
          setAttachedImageCount(imageAttachments.length)
          if (textareaRef) {
            isPasting = true
            textareaRef.insertText(`[Image #${imageCounter}]`)
            updateLineCount()
            clearTimeout(isPastingTimer)
            isPastingTimer = setTimeout(() => { isPasting = false }, PASTE_GUARD_MS)
          }
          return
        }
        if (result.reason === "too_large") {
          toast.warn("Image too large (>5MB). Try a smaller screenshot.")
          return
        }
        // No image — fall back to text clipboard
        return readClipboard().then(async (raw) => {
          if (!raw) return
          const text = raw.replace(/\r\n?/g, "\n")

          // Check if pasted text is a path to an image file
          if (isImageFilePath(text)) {
            const img = await readImageFile(text)
            if (img) {
              imageCounter++
              imageAttachments.push(img)
              if (textareaRef) {
                isPasting = true
                textareaRef.insertText(`[Image #${imageCounter}]`)
                updateLineCount()
                clearTimeout(isPastingTimer)
                isPastingTimer = setTimeout(() => { isPasting = false }, PASTE_GUARD_MS)
              }
              toast.success(`Attached image: ${text.split("/").pop()}`)
              return
            }
          }

          // Smart paste truncation for large clipboard content
          const insertText = truncatePastedText(text)
          if (textareaRef) {
            isPasting = true
            textareaRef.insertText(insertText)
            updateLineCount()
            clearTimeout(isPastingTimer)
            isPastingTimer = setTimeout(() => { isPasting = false }, PASTE_GUARD_MS)
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
        imageAttachments = []
        imageCounter = 0
        setAttachedImageCount(0)
        toast.info("Cleared image attachments")
        // Remove [Image #N] pills from text
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
          // For file autocomplete, remove just the @query portion
          const text = textareaRef?.plainText ?? ""
          const atMatch = text.match(/@(\S*)$/)
          if (atMatch) {
            setTextareaContent(text.slice(0, atMatch.index!))
          }
        } else {
          // For slash commands, clear the "/" text per Claude Code behavior
          textareaRef?.clear()
          setLineCount(1)
        }
      } else if (tabMatches.length > 0) {
        // Dismiss active tab completion
        setCompletionHint("")
        tabIndex = -1
        tabMatches = []
      } else {
        // Clear the textarea and any image attachments
        textareaRef?.clear()
        setLineCount(1)
        imageAttachments = []
        imageCounter = 0
        setAttachedImageCount(0)
        pasteStore.clear()
        historyIndex = -1
        savedInput = ""
      }
      return
    }

    // ── Emacs keybindings ──────────────────────────────────────────────
    // Standard Emacs/readline cursor movement, editing, and word operations.
    // These match the keybindings in bash, zsh, and most terminal programs.

    // Ctrl+A = beginning of line (Emacs)
    if (e.ctrl && e.name === "a") {
      e.preventDefault()
      textareaRef?.gotoLineHome()
      return
    }

    // Ctrl+E = end of line (Emacs)
    if (e.ctrl && e.name === "e") {
      e.preventDefault()
      textareaRef?.gotoLineEnd()
      return
    }

    // Ctrl+F = forward one character (Emacs)
    if (e.ctrl && e.name === "f") {
      e.preventDefault()
      textareaRef?.moveCursorRight()
      return
    }

    // Ctrl+B = backward one character (Emacs)
    if (e.ctrl && e.name === "b") {
      e.preventDefault()
      textareaRef?.moveCursorLeft()
      return
    }

    // Ctrl+N = next line (Emacs)
    if (e.ctrl && e.name === "n") {
      e.preventDefault()
      textareaRef?.moveCursorDown()
      return
    }

    // Ctrl+P = previous line (Emacs)
    if (e.ctrl && e.name === "p") {
      e.preventDefault()
      textareaRef?.moveCursorUp()
      return
    }

    // Ctrl+D = delete character forward (Emacs)
    // When the editor is empty, app.tsx handles Ctrl+D for exit (double-press).
    if (e.ctrl && e.name === "d") {
      e.preventDefault()
      textareaRef?.deleteChar()
      queueMicrotask(() => { updateLineCount(); updateAutocomplete(textareaRef?.plainText ?? "") })
      return
    }

    // Ctrl+H = delete character backward / backspace (Emacs)
    if (e.ctrl && e.name === "h") {
      e.preventDefault()
      textareaRef?.deleteCharBackward()
      queueMicrotask(() => { updateLineCount(); updateAutocomplete(textareaRef?.plainText ?? "") })
      return
    }

    // Ctrl+T = transpose characters (Emacs)
    if (e.ctrl && e.name === "t") {
      e.preventDefault()
      if (!textareaRef) return
      const text = textareaRef.plainText
      const pos = textareaRef.cursorOffset
      if (pos <= 0 || text.length < 2) return
      // At end of text: swap the two characters before the cursor.
      // Otherwise: swap char before cursor with char at cursor, advance.
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
    if (e.ctrl && e.name === "k") {
      e.preventDefault()
      textareaRef?.deleteToLineEnd()
      queueMicrotask(() => { updateLineCount(); updateAutocomplete(textareaRef?.plainText ?? "") })
      return
    }

    // Ctrl+U = kill to start of line (Emacs unix-line-discard)
    if (e.ctrl && e.name === "u") {
      e.preventDefault()
      textareaRef?.deleteToLineStart()
      queueMicrotask(() => { updateLineCount(); updateAutocomplete(textareaRef?.plainText ?? "") })
      return
    }

    // Ctrl+W = kill word backward (Emacs unix-word-rubout)
    if (e.ctrl && e.name === "w") {
      e.preventDefault()
      textareaRef?.deleteWordBackward()
      queueMicrotask(() => { updateLineCount(); updateAutocomplete(textareaRef?.plainText ?? "") })
      return
    }

    // Ctrl+Y = yank / paste from clipboard (Emacs yank)
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

    // Alt+F = forward one word (Emacs)
    if (e.option && e.name === "f") {
      e.preventDefault()
      textareaRef?.moveWordForward()
      return
    }

    // Alt+B = backward one word (Emacs)
    if (e.option && e.name === "b") {
      e.preventDefault()
      textareaRef?.moveWordBackward()
      return
    }

    // Alt+D = delete word forward (Emacs kill-word)
    if (e.option && e.name === "d") {
      e.preventDefault()
      textareaRef?.deleteWordForward()
      queueMicrotask(() => { updateLineCount(); updateAutocomplete(textareaRef?.plainText ?? "") })
      return
    }

    // Ctrl+G = open external editor for multi-line prompt composition
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

      // Enter = execute selected command / insert selected file
      if (isSubmitKey(e)) {
        e.preventDefault()
        const selected = items[selectedIndex()]
        if (selected) {
          if (autocompleteMode() === "file") {
            selectFile(selected.name)
          } else {
            // Slash command: fill and submit
            setTextareaContent(`/${selected.name}`)
            dismissAutocomplete()
            submit()
          }
        }
        return
      }

      // Tab = fill selected item into input (without executing)
      if (e.name === "tab") {
        e.preventDefault()
        if (autocompleteMode() === "file") {
          // Tab in file mode: fill common prefix if longer than query, else select item
          const commonPrefix = findLongestCommonPrefix(items.map((i) => i.name))
          const text = textareaRef?.plainText ?? ""
          const atMatch = text.match(/@(\S*)$/)
          const currentQuery = atMatch?.[1] ?? ""

          if (commonPrefix.length > currentQuery.length) {
            // Fill common prefix without dismissing autocomplete
            const beforeAt = text.slice(0, atMatch?.index ?? text.length)
            setTextareaContent(beforeAt + "@" + commonPrefix)
            // Re-trigger autocomplete with expanded query
            queueMicrotask(() =>
              updateAutocomplete(beforeAt + "@" + commonPrefix),
            )
            return
          }
          // No longer common prefix — select the current item
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
    if (e.name === "tab") {
      e.preventDefault()
      const text = textareaRef?.plainText ?? ""
      if (text.startsWith("/")) {
        const query = text.slice(1).split(/\s/)[0] ?? ""

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
      setTextareaContent(inputHistory[historyIndex] ?? "")
      return
    }

    // Down arrow = move forward in history (not Ctrl+Down which scrolls conversation)
    if (e.name === "down" && !e.ctrl && historyIndex !== -1) {
      e.preventDefault()
      if (historyIndex < inputHistory.length - 1) {
        historyIndex++
        setTextareaContent(inputHistory[historyIndex] ?? "")
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
          <text fg={isDisabled() ? colors.text.inactive : "white"} attributes={isDisabled() ? TextAttributes.DIM : 0}>{"❯"}</text>
        </box>
        <textarea
          ref={(el: TextareaRenderable) => { textareaRef = el; _sharedTextareaRef = el }}
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
                  fg={index === selectedIndex() ? "cyan" : "white"}
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

/**
 * Get a copy of the input history array (for history search).
 * Returns entries in chronological order (oldest first).
 */
export function getInputHistory(): string[] {
  return inputHistory.slice()
}

/**
 * Set the textarea content programmatically (e.g., from history search selection).
 * Clears existing text and inserts the new text.
 */
export function setInputText(text: string): void {
  if (!_sharedTextareaRef) return
  _sharedTextareaRef.clear()
  if (text) _sharedTextareaRef.insertText(text)
}

/** Exported for testing */
export { commandRegistry }
