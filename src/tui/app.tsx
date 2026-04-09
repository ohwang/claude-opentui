/**
 * Root TUI Application
 *
 * Composes context providers and layout components.
 * Entry point for the SolidJS + OpenTUI rendering.
 */

import { render, useKeyboard, useRenderer } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { createSignal, createEffect, on, onCleanup, ErrorBoundary, Show } from "solid-js"
import type { AgentBackend, SessionConfig } from "../protocol/types"
import { log } from "../utils/logger"
import { copyToClipboard } from "../utils/clipboard"
import { sendTerminalNotification, setTerminalProgress } from "../utils/terminal-notify"
import { disableFocusReporting } from "../utils/terminal-focus"
import { useAwaySummary } from "./hooks/useAwaySummary"
import { AgentProvider, useAgent, type AgentContextValue } from "./context/agent"
import { MessagesProvider, useMessages } from "./context/messages"
import { SessionProvider, useSession } from "./context/session"
import { PermissionsProvider } from "./context/permissions"
import { SyncProvider, useSync } from "./context/sync"
import { ToastProvider, toast } from "./context/toast"
import { ModalProvider, useModal, registerModalRef, type ModalComponent } from "./context/modal"
import { AnimationProvider } from "./context/animation"
import { setBackend, setConfig, setRenderer } from "../mcp/state-bridge"
import { startMcpHttpServer, stopMcpHttpServer } from "../mcp/server"
import { colors } from "./theme/tokens"
import { ConversationView } from "./components/conversation"
import { Divider } from "./components/primitives"
import { InputArea, clearInput, hasInputText, refocusInput, hideCursor, showCursor, isCursorHidden, getInputHistory, setInputText } from "./components/input-area"
import { HistorySearchModal } from "./components/history-search"
import { StatusBar } from "./components/status-bar"
import { PermissionDialog } from "./components/permission-dialog"
import { ElicitationDialog } from "./components/elicitation"
import { DiagnosticsPanel, scrollDiagnostics, scrollDiagnosticsToTop, scrollDiagnosticsToBottom, switchDiagnosticsTab } from "./components/diagnostics"
import { MODEL_NAMES, friendlyModelName, friendlyBackendName } from "./models"

// Module-level exit function so slash commands can trigger clean shutdown
let _cleanExit: (() => void) | undefined
export function triggerCleanExit(): void {
  _cleanExit?.()
}

// Module-level diagnostics toggle so slash commands can open the panel
let _toggleDiagnostics: (() => void) | undefined
export function toggleDiagnostics(): void {
  _toggleDiagnostics?.()
}

// Module-level copy hint so the render callback (outside component tree) can show status hints
let _showCopyHint: ((chars: number) => void) | undefined
export function showCopyConfirmation(chars: number): void {
  _showCopyHint?.(chars)
}

/** Render a full-width dash separator line (Claude Code style) — uses Divider primitive */
function DashLine() {
  return (
    <box flexShrink={0}>
      <Divider fg={colors.border.default} />
    </box>
  )
}

function ErrorFallback(props: { error: Error; reset: () => void }) {
  return (
    <box flexDirection="column" padding={2}>
      <text fg={colors.status.error} attributes={TextAttributes.BOLD}>
        Fatal Error
      </text>
      <text fg={colors.status.error}>{props.error.message}</text>
      <text fg={colors.text.inactive}>Press Ctrl+D to exit.</text>
    </box>
  )
}

function Layout(props: { onExit?: () => void }) {
  const { state: session } = useSession()
  const { state: messagesState } = useMessages()
  const agent = useAgent()
  const sync = useSync()
  const modal = useModal()
  const messages = useMessages()
  registerModalRef(modal)
  // Counter-based rapid-press exit (matches Claude Code behavior)
  let ctrlDCount = 0
  let ctrlDTimer: ReturnType<typeof setTimeout> | undefined
  let ctrlCEmptyCount = 0
  let ctrlCTimer: ReturnType<typeof setTimeout> | undefined
  // Ctrl+B double-press for background/foreground toggle
  let ctrlBCount = 0
  let ctrlBTimer: ReturnType<typeof setTimeout> | undefined
  const [statusHint, setStatusHint] = createSignal<string | null>(null)
  const [showDiagnostics, setShowDiagnostics] = createSignal(false)
  let statusHintTimer: ReturnType<typeof setTimeout> | undefined

  // Model cycling state (Ctrl+P / Shift+Ctrl+P)
  const modelIds = Object.keys(MODEL_NAMES)
  const [modelIndex, setModelIndex] = createSignal(0)

  // Initialize model index from the current session model once available
  createEffect(on(
    () => session.currentModel,
    (current) => {
      if (current) {
        const idx = modelIds.indexOf(current)
        if (idx >= 0) setModelIndex(idx)
      }
    }
  ))

  // Away summary — show a recap when the user returns after >= 3 minutes
  useAwaySummary({
    getBlocksSinceLastActivity: () => {
      const blocks = messages.state.blocks
      let toolCount = 0
      let assistantCount = 0
      for (let i = blocks.length - 1; i >= 0; i--) {
        const b = blocks[i]!
        if (b.type === "user") break
        if (b.type === "tool") toolCount++
        if (b.type === "assistant") assistantCount++
      }
      return { toolCount, assistantCount }
    },
    onShowSummary: (summary) => {
      toast.info(summary, 6000)
    },
  })

  const renderer = useRenderer()
  setRenderer(renderer)

  /**
   * Copy text to clipboard, preferring OSC 52 (instant, no subprocess, works
   * over SSH) and falling back to native tools (pbcopy/xclip).
   * Both OpenCode and Claude Code use this dual strategy.
   */
  const copyText = (text: string) => {
    if (renderer.isOsc52Supported()) {
      renderer.copyToClipboardOSC52(text)
      showCopyConfirmation(text.length)
      log.info("Copied selection via OSC 52", { chars: text.length })
    } else {
      copyToClipboard(text).then(() => {
        showCopyConfirmation(text.length)
        log.info("Copied selection via clipboard cmd", { chars: text.length })
      }).catch((err: unknown) => {
        log.warn("Failed to copy selection", { error: err instanceof Error ? err.message : String(err) })
      })
    }
  }

  const cleanExit = (reason: string) => {
    log.info("Clean exit", { reason })
    stopMcpHttpServer().catch(() => {})
    disableFocusReporting()
    sync.pushEvent({ type: "shutdown" })
    agent.backend.close()
    props.onExit?.()
    // Capture backend session ID before destroying renderer
    const backendSessionId = session.session?.sessionId
    if (backendSessionId) {
      log.setBackendSessionId(backendSessionId)
    }
    try {
      renderer.destroy()
    } catch (e) {
      // Destruction errors must never prevent exit — log and continue.
      // SolidJS onCleanup callbacks run during destroy and may reference
      // stale variables (e.g., removed timers). This is a safety net.
      log.error("renderer.destroy() failed", { error: String(e) })
    }
    // Print session info — this is the primary output path. The
    // process.on("exit") handler in index.ts is a fallback for non-cleanExit
    // paths (SIGINT safety-net, SIGTERM, etc.).
    log.printSessionInfo()
    process.exit(0)
  }

  // Expose clean exit for slash commands (/exit, /quit, /q)
  _cleanExit = () => cleanExit("slash-command")

  // Expose diagnostics toggle for slash commands (/diagnostics)
  _toggleDiagnostics = () => setShowDiagnostics((v) => !v)

  _showCopyHint = (chars: number) => {
    toast.success(`Copied ${chars} chars to clipboard`)
  }

  // Register diagnostics panel as an overlay so escape coordination works
  createEffect(() => {
    if (showDiagnostics()) {
      modal.registerOverlay("diagnostics")
      hideCursor()
    } else {
      modal.unregisterOverlay("diagnostics")
      showCursor()
    }
  })

  // Notify when a backgrounded task completes
  let wasBackgrounded = false
  createEffect(on(
    () => [messagesState.backgrounded, session.sessionState] as const,
    ([backgrounded, sessionState]) => {
      if (wasBackgrounded && !backgrounded && sessionState === "IDLE") {
        toast.success("Background task completed")
      }
      wasBackgrounded = backgrounded
    }
  ))

  // Terminal progress + desktop notifications on session state transitions
  let prevNotifyState: string = session.sessionState
  createEffect(on(
    () => session.sessionState,
    (current) => {
      // IDLE/other -> RUNNING: show progress indicator
      if (current === "RUNNING" && prevNotifyState !== "RUNNING") {
        setTerminalProgress("running", 0)
      }

      // RUNNING/INTERRUPTING -> IDLE: turn completed — clear progress + notify
      if (current === "IDLE" && (prevNotifyState === "RUNNING" || prevNotifyState === "INTERRUPTING")) {
        setTerminalProgress("clear")
        // Only send desktop notification if the terminal is not focused
        // (i.e., user has tabbed away). We always send it since the terminal
        // emulator decides whether to show it based on focus state.
        sendTerminalNotification(friendlyBackendName(agent.backend.capabilities().name), "Task completed")
      }

      // -> ERROR: show error progress
      if (current === "ERROR") {
        setTerminalProgress("error")
      }

      prevNotifyState = current
    }
  ))

  /** Show a transient status hint that auto-clears after the given duration */
  const showTransientHint = (text: string, durationMs = 2000) => {
    setStatusHint(text)
    clearTimeout(statusHintTimer)
    statusHintTimer = setTimeout(() => setStatusHint(null), durationMs)
  }

  /** Cycle model by delta (+1 forward, -1 backward), call setModel, show hint */
  const cycleModel = (delta: number) => {
    // Only allow model cycling when idle (not mid-turn)
    if (session.sessionState !== "IDLE" && session.sessionState !== "INITIALIZING") {
      toast.warn("Cannot switch model while running")
      return
    }
    if (modelIds.length === 0) return

    const nextIdx = ((modelIndex() + delta) % modelIds.length + modelIds.length) % modelIds.length
    setModelIndex(nextIdx)
    const modelId = modelIds[nextIdx]!
    const displayName = friendlyModelName(modelId)

    // Fire-and-forget model switch on the backend
    agent.backend.setModel(modelId).catch((err: unknown) => {
      log.warn("Failed to set model", { model: modelId, error: String(err) })
      toast.error(`Failed to switch model: ${err instanceof Error ? err.message : String(err)}`)
    })

    // Emit model_changed event so the session store / status bar update
    sync.pushEvent({ type: "model_changed", model: modelId })
    toast.info(`Switched to ${displayName}`)
  }

  // Track last 'g' keypress for vim-style gg (go to top) in diagnostics
  let lastGPressTime = 0

  // Global keyboard shortcuts
  useKeyboard((event) => {
    try {
    // When modal overlay is active, delegate to the modal's key handler first,
    // then fall back to Escape-to-dismiss. Block all other unhandled keys.
    if (modal.isActive()) {
      const handler = modal.keyHandler()
      if (handler) {
        const handled = handler(event)
        if (handled) {
          event.preventDefault()
          return
        }
      }
      if (event.name === "escape") {
        event.preventDefault()
        modal.dismiss()
        return
      }
      event.preventDefault()
      return
    }

    // When diagnostics overlay is open, capture ALL keyboard input.
    // Only allow close keys (Esc, q, Ctrl+Shift+D) — block everything
    // else from reaching the textarea or other handlers.
    if (showDiagnostics()) {
      if (event.name === "escape" || event.name === "q") {
        event.preventDefault()
        setShowDiagnostics(false)
        return
      }
      if (event.ctrl && event.shift && event.name === "d") {
        event.preventDefault()
        setShowDiagnostics(false)
        return
      }
      // Tab switching: 1/2 for direct, Tab to cycle
      if (event.name === "1") { event.preventDefault(); switchDiagnosticsTab(0); return }
      if (event.name === "2") { event.preventDefault(); switchDiagnosticsTab(1); return }
      if (event.name === "tab") { event.preventDefault(); switchDiagnosticsTab(); return }
      // Vim-style scrolling: j/k for line, d/u for half-page, gg/G top/bottom
      if (event.name === "j") { event.preventDefault(); scrollDiagnostics(1); return }
      if (event.name === "k") { event.preventDefault(); scrollDiagnostics(-1); return }
      if (event.name === "d") { event.preventDefault(); scrollDiagnostics(10); return }
      if (event.name === "u") { event.preventDefault(); scrollDiagnostics(-10); return }
      // G (shift+g) → jump to bottom
      if (event.shift && event.name === "g") { event.preventDefault(); scrollDiagnosticsToBottom(); return }
      // gg → jump to top (two 'g' presses within 500ms)
      if (event.name === "g") {
        event.preventDefault()
        const now = Date.now()
        if (now - lastGPressTime < 500) {
          scrollDiagnosticsToTop()
          lastGPressTime = 0
        } else {
          lastGPressTime = now
        }
        return
      }
      // Block all other keys from reaching the textarea
      event.preventDefault()
      return
    }

    // Ctrl+Shift+D: toggle diagnostics panel
    if (event.ctrl && event.shift && event.name === "d") {
      setShowDiagnostics(true)
      return
    }

    // Ctrl+Shift+P: cycle models (Ctrl+P freed for Emacs previous-line)
    if (event.ctrl && event.shift && event.name === "p") {
      event.preventDefault()
      cycleModel(1)
      return
    }

    // Ctrl+R: open history search modal
    if (event.ctrl && event.name === "r") {
      event.preventDefault()
      const history = getInputHistory()
      modal.show(() => (
        <HistorySearchModal
          history={history}
          onSelect={(text) => {
            modal.dismiss()
            setInputText(text)
            refocusInput()
          }}
          onCancel={() => {
            modal.dismiss()
            refocusInput()
          }}
        />
      ))
      return
    }

    // Ctrl+D: exit when editor is empty (matches native Claude Code)
    // First press = hint, second press within 4s = exit
    if (event.ctrl && event.name === "d") {
      if (hasInputText()) return  // Ignore when editor has text
      ctrlDCount++
      clearTimeout(ctrlDTimer)
      ctrlDTimer = setTimeout(() => { ctrlDCount = 0 }, 4000)
      if (ctrlDCount >= 2) {
        cleanExit("ctrl+d double-press")
      } else {
        showTransientHint("Press Ctrl-D again to exit", 4000)
      }
      return
    }

    // Ctrl+L to clear the conversation display
    if (event.ctrl && event.name === "l") {
      sync.clearConversation()
      return
    }

    // Ctrl+Shift+B: background/foreground toggle (double-press within 800ms)
    // (Ctrl+B freed for Emacs backward-char)
    if (event.ctrl && event.shift && event.name === "b") {
      if (messagesState.backgrounded) {
        // Already backgrounded — single press returns to foreground
        sync.pushEvent({ type: "task_foreground" })
        toast.info("Returned to foreground")
        ctrlBCount = 0
        clearTimeout(ctrlBTimer)
        return
      }
      if (session.sessionState === "RUNNING") {
        ctrlBCount++
        clearTimeout(ctrlBTimer)
        if (ctrlBCount >= 2) {
          // Second press — background the task
          ctrlBCount = 0
          sync.pushEvent({ type: "task_background" })
          toast.info("Running in background \u00B7 Ctrl+B to return")
          refocusInput()
        } else {
          // First press — show hint
          showTransientHint("Press Ctrl+B again to run in background", 800)
          ctrlBTimer = setTimeout(() => { ctrlBCount = 0 }, 800)
        }
      }
      return
    }

    // Cmd+C (Super+C) on macOS: copy selection if available.
    // In the Kitty keyboard protocol, Cmd maps to `super` (not `meta`).
    // Requires the terminal to forward cmd+c to the app instead of
    // intercepting it — in Kitty, use `map cmd+c copy_or_interrupt`.
    if ((event.super || event.meta) && event.name === "c") {
      if (renderer.hasSelection) {
        const sel = renderer.getSelection()
        if (sel && sel.isActive) {
          const text = sel.getSelectedText()
          if (text) {
            event.preventDefault()
            copyText(text)
            renderer.clearSelection()
          }
        }
      }
      return
    }

    // Ctrl+C: text=clear, empty single=nothing, empty double=exit, running=interrupt
    if (event.ctrl && event.name === "c") {
      // Check for active text selection — copy takes priority over interrupt/clear
      if (renderer.hasSelection) {
        const sel = renderer.getSelection()
        if (sel && sel.isActive) {
          const text = sel.getSelectedText()
          if (text) {
            event.preventDefault()
            copyText(text)
            renderer.clearSelection()
            return
          }
        }
      }

      // If a non-modal overlay is active (e.g. autocomplete dropdown),
      // skip interrupt and let Ctrl+C fall through to clear input instead.
      // This prevents accidentally cancelling a running task when the user
      // just wants to dismiss an overlay.
      if (
        !modal.isAnyOverlayActive() && (
          session.sessionState === "RUNNING" ||
          session.sessionState === "WAITING_FOR_PERM" ||
          session.sessionState === "WAITING_FOR_ELIC" ||
          session.sessionState === "INTERRUPTING"
        )
      ) {
        if (session.sessionState === "INTERRUPTING") {
          // Already interrupting \u2014 show hint about force exit
          showTransientHint("Interrupt pending... Press Ctrl+D\u00D72 to force exit", 3000)
        } else {
          sync.pushEvent({ type: "interrupt" })
          const interruptName = friendlyBackendName(agent.backend.capabilities().name)
          sync.pushEvent({ type: "system_message", text: `Interrupted \u00B7 What should ${interruptName} do instead?`, ephemeral: true })
          try {
            agent.backend.interrupt()
          } catch (e) {
            log.error("Failed to interrupt backend", { error: String(e) })
          }
        }
      } else {
        const hadText = clearInput()
        if (!hadText) {
          ctrlCEmptyCount++
          clearTimeout(ctrlCTimer)
          ctrlCTimer = setTimeout(() => { ctrlCEmptyCount = 0 }, 4000)
          if (ctrlCEmptyCount >= 2) {
            cleanExit("ctrl+c double-press")
          } else {
            // Show "Press Ctrl-C again to exit" hint in status bar
            showTransientHint("Press Ctrl-C again to exit", 4000)
          }
        } else {
          ctrlCEmptyCount = 0
          setStatusHint(null)
        }
      }
    }

    // Always keep the textarea focused when the session allows typing.
    // In native Claude Code, the user can scroll up to read history and
    // then just start typing without clicking. OpenTUI's single-focus
    // model can shift focus to the scrollbox (e.g. on mouse click or
    // scroll interaction). Re-focusing on every keypress ensures the
    // textarea immediately reclaims input regardless of what stole focus.
    // Skip refocusing when the diagnostics overlay is open, or when the
    // user has scrolled away from the input area, so cursor stays hidden.
    const typingDisabled =
      session.sessionState === "WAITING_FOR_PERM" ||
      session.sessionState === "WAITING_FOR_ELIC" ||
      session.sessionState === "SHUTTING_DOWN" ||
      showDiagnostics() ||
      modal.isActive() ||
      isCursorHidden()
    if (!typingDisabled) {
      refocusInput()
    }
    } catch (e) {
      log.error("Keyboard handler error", { error: String(e) })
    }
  })

  onCleanup(() => {
    clearTimeout(ctrlDTimer)
    clearTimeout(ctrlCTimer)
    clearTimeout(ctrlBTimer)
    clearTimeout(statusHintTimer)
  })

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Keep ConversationView always mounted to preserve textarea state.
           Hide it via height={0} + visible={false} when diagnostics or modal
           overlay is open.  height={0} alone isn't sufficient — child elements
           (e.g. StatusBar) can leak through the zero-height parent. */}
      <box flexDirection="column" width="100%" height={(showDiagnostics() || modal.isActive()) ? 0 : "100%"} flexGrow={(showDiagnostics() || modal.isActive()) ? 0 : 1} visible={!showDiagnostics() && !modal.isActive()}>
        <ConversationView footerHint={statusHint()}>
          {/* Permission dialog (shown inline when WAITING_FOR_PERM) */}
          <PermissionDialog />

          {/* Elicitation dialog (shown inline when WAITING_FOR_ELIC) */}
          <ElicitationDialog />

          <DashLine />
          <InputArea />
          <DashLine />

          {/* Status bar */}
          <StatusBar />
        </ConversationView>
      </box>

      {/* Modal overlay — replaces conversation when active */}
      <Show when={modal.content()}>
        {(getComponent: () => ModalComponent) => (
          <box flexDirection="column" flexGrow={1} width="100%" height="100%">
            {getComponent()()}
          </box>
        )}
      </Show>

      {/* Diagnostics panel — replaces conversation when visible */}
      <DiagnosticsPanel
        visible={showDiagnostics()}
        onClose={() => setShowDiagnostics(false)}
      />
    </box>
  )
}

export interface AppOptions {
  backend: AgentBackend
  config: SessionConfig
  onExit?: () => void
  noDiagnosticsMcp?: boolean
}

export function startApp(options: AppOptions): void {
  setBackend(options.backend)
  setConfig(options.config)

  const agentValue: AgentContextValue = {
    backend: options.backend,
    config: options.config,
  }

  render(() => (
    <ErrorBoundary
      fallback={(error: Error, reset: () => void) => (
        <ErrorFallback error={error} reset={reset} />
      )}
    >
      <AgentProvider value={agentValue}>
        <SessionProvider>
          <MessagesProvider>
            <PermissionsProvider>
              <SyncProvider>
                <AnimationProvider>
                  <ToastProvider>
                    <ModalProvider>
                      <Layout onExit={options.onExit} />
                    </ModalProvider>
                  </ToastProvider>
                </AnimationProvider>
              </SyncProvider>
            </PermissionsProvider>
          </MessagesProvider>
        </SessionProvider>
      </AgentProvider>
    </ErrorBoundary>
  ), {
    targetFps: 60,
    exitOnCtrlC: false,
    useMouse: true,
    // Enable Kitty keyboard protocol for proper modifier key detection.
    // Without this, Cmd+C is intercepted by the terminal emulator at the
    // OS level and never reaches the app. With it, terminals that support
    // the protocol (Kitty, WezTerm, Ghostty, iTerm2, etc.) send Cmd+C as
    // a distinct key event with meta=true, making copy-on-selection work.
    // Matches OpenCode's configuration.
    useKittyKeyboard: {},
    consoleOptions: {
      onCopySelection: (text: string) => {
        copyToClipboard(text).then(() => {
          log.info("Copied console selection to clipboard", { chars: text.length })
          showCopyConfirmation(text.length)
        }).catch((err: unknown) => {
          log.warn("Failed to copy console selection", {
            error: err instanceof Error ? err.message : String(err),
          })
        })
      },
      selectionColor: colors.bg.selection,
    },
  })

  // Start the MCP diagnostics server (non-blocking)
  if (!options.noDiagnosticsMcp) {
    startMcpHttpServer().then(({ port }) => {
      log.info("MCP diagnostics server started", { port })
    }).catch(err => {
      log.warn("MCP server failed to start", { error: String(err) })
    })
  }
}
