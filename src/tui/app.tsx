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
import { AgentProvider, useAgent, type AgentContextValue } from "./context/agent"
import { MessagesProvider } from "./context/messages"
import { SessionProvider, useSession } from "./context/session"
import { PermissionsProvider } from "./context/permissions"
import { SyncProvider, useSync } from "./context/sync"
import { colors } from "./theme/tokens"
import { useTerminalDimensions } from "@opentui/solid"
import { ConversationView } from "./components/conversation"
import { InputArea, clearInput, hasInputText, refocusInput } from "./components/input-area"
import { StatusBar } from "./components/status-bar"
import { PermissionDialog } from "./components/permission-dialog"
import { ElicitationDialog } from "./components/elicitation"
import { DiagnosticsPanel, scrollDiagnostics } from "./components/diagnostics"
import { ContextualTips } from "./components/tips"
import { MODEL_NAMES, friendlyModelName } from "./models"

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

/** Render a full-width dash separator line (Claude Code style) */
function DashLine() {
  const dims = useTerminalDimensions()
  const width = () => dims()?.width ?? 120
  const dashes = () => "─".repeat(Math.max(width(), 40))
  return (
    <box height={1} flexShrink={0}>
      <text fg={colors.text.muted}>{dashes()}</text>
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
      <text fg={colors.text.muted}>Press Ctrl+D to exit.</text>
    </box>
  )
}

function Layout(props: { onExit?: () => void }) {
  const { state: session } = useSession()
  const agent = useAgent()
  const sync = useSync()
  // Counter-based rapid-press exit (matches Claude Code behavior)
  let ctrlDCount = 0
  let ctrlDTimer: ReturnType<typeof setTimeout> | undefined
  let ctrlCEmptyCount = 0
  let ctrlCTimer: ReturnType<typeof setTimeout> | undefined
  const [statusHint, setStatusHint] = createSignal<string | null>(null)
  const [showDiagnostics, setShowDiagnostics] = createSignal(false)
  let statusHintTimer: ReturnType<typeof setTimeout> | undefined
  let interruptTimeout: ReturnType<typeof setTimeout> | undefined

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

  const renderer = useRenderer()

  const cleanExit = (reason: string) => {
    log.info("Clean exit", { reason })
    sync.pushEvent({ type: "shutdown" })
    agent.backend.close()
    props.onExit?.()
    renderer.destroy()
    process.exit(0)
  }

  // Expose clean exit for slash commands (/exit, /quit, /q)
  _cleanExit = () => cleanExit("slash-command")

  // Expose diagnostics toggle for slash commands (/diagnostics)
  _toggleDiagnostics = () => setShowDiagnostics((v) => !v)

  _showCopyHint = (chars: number) => {
    showTransientHint(`Copied ${chars} chars to clipboard`)
  }

  // Clear interrupt timeout when state transitions away from INTERRUPTING
  createEffect(on(
    () => session.sessionState,
    (state) => {
      if (state !== "INTERRUPTING" && interruptTimeout) {
        clearTimeout(interruptTimeout)
        interruptTimeout = undefined
      }
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
      showTransientHint("Cannot switch model while running")
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
      showTransientHint(`Failed to switch model: ${err instanceof Error ? err.message : String(err)}`)
    })

    // Emit model_changed event so the session store / status bar update
    sync.pushEvent({ type: "model_changed", model: modelId })
    showTransientHint(`Switched to ${displayName}`)
  }

  // Global keyboard shortcuts
  useKeyboard((event) => {
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
      // Vim-style scrolling: j/k for line, d/u for half-page
      if (event.name === "j") { event.preventDefault(); scrollDiagnostics(1); return }
      if (event.name === "k") { event.preventDefault(); scrollDiagnostics(-1); return }
      if (event.name === "d") { event.preventDefault(); scrollDiagnostics(10); return }
      if (event.name === "u") { event.preventDefault(); scrollDiagnostics(-10); return }
      // Block all other keys from reaching the textarea
      event.preventDefault()
      return
    }

    // Ctrl+Shift+D: toggle diagnostics panel
    if (event.ctrl && event.shift && event.name === "d") {
      setShowDiagnostics(true)
      return
    }

    // Ctrl+P / Shift+Ctrl+P: cycle models forward / backward
    if (event.ctrl && event.name === "p") {
      cycleModel(event.shift ? -1 : 1)
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

    // Meta+C (Cmd+C on macOS): copy selection if available
    if (event.meta && event.name === "c") {
      if (renderer.hasSelection) {
        const sel = renderer.getSelection()
        if (sel && sel.hasSelection()) {
          const text = sel.getSelectedText()
          if (text) {
            event.preventDefault()
            copyToClipboard(text).then(() => {
              showCopyConfirmation(text.length)
            }).catch((err: unknown) => {
              log.warn("Failed to copy selection", { error: err instanceof Error ? err.message : String(err) })
            })
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
        if (sel && sel.hasSelection()) {
          const text = sel.getSelectedText()
          if (text) {
            event.preventDefault()
            copyToClipboard(text).then(() => {
              showCopyConfirmation(text.length)
            }).catch((err: unknown) => {
              log.warn("Failed to copy selection", { error: err instanceof Error ? err.message : String(err) })
            })
            renderer.clearSelection()
            return
          }
        }
      }

      if (
        session.sessionState === "RUNNING" ||
        session.sessionState === "WAITING_FOR_PERM" ||
        session.sessionState === "WAITING_FOR_ELIC" ||
        session.sessionState === "INTERRUPTING"
      ) {
        if (session.sessionState === "INTERRUPTING") {
          // Already interrupting \u2014 show hint about force exit
          showTransientHint("Interrupt pending... Press Ctrl+D\u00D72 to force exit", 3000)
        } else {
          sync.pushEvent({ type: "interrupt" })
          sync.pushEvent({ type: "system_message", text: "⎿  Interrupted \u00B7 What should Claude do instead?" })
          agent.backend.interrupt()

          // Interrupt timeout \u2014 if the SDK doesn't respond within 10s, force recovery
          interruptTimeout = setTimeout(() => {
            if (session.sessionState === "INTERRUPTING") {
              log.warn("Interrupt timed out after 10s \u2014 forcing recovery")
              sync.pushEvent({ type: "system_message", text: "Interrupt timed out \u2014 recovering." })
              sync.pushEvent({
                type: "turn_complete",
                usage: { inputTokens: 0, outputTokens: 0 },
              })
            }
          }, 10_000)
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
    // Skip refocusing when the diagnostics overlay is open so it doesn't
    // steal focus back from the overlay.
    const typingDisabled =
      session.sessionState === "WAITING_FOR_PERM" ||
      session.sessionState === "WAITING_FOR_ELIC" ||
      session.sessionState === "SHUTTING_DOWN" ||
      showDiagnostics()
    if (!typingDisabled) {
      refocusInput()
    }
  })

  onCleanup(() => {
    clearTimeout(ctrlDTimer)
    clearTimeout(ctrlCTimer)
    clearTimeout(statusHintTimer)
    clearTimeout(interruptTimeout)
  })

  return (
    <box flexDirection="column" width="100%" height="100%">
      <Show when={!showDiagnostics()}>
        <ConversationView>
          {/* Permission dialog (shown inline when WAITING_FOR_PERM) */}
          <PermissionDialog />

          {/* Elicitation dialog (shown inline when WAITING_FOR_ELIC) */}
          <ElicitationDialog />

          {/* Contextual keyboard tips + input area */}
          <ContextualTips />
          <DashLine />
          <InputArea />
          <DashLine />

          {/* Status bar */}
          <StatusBar hint={statusHint()} />
        </ConversationView>
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
}

export function startApp(options: AppOptions): void {
  const agentValue: AgentContextValue = {
    backend: options.backend,
    config: options.config,
  }

  render(() => (
    <ErrorBoundary
      fallback={(error, reset) => (
        <ErrorFallback error={error} reset={reset} />
      )}
    >
      <AgentProvider value={agentValue}>
        <SessionProvider>
          <MessagesProvider>
            <PermissionsProvider>
              <SyncProvider>
                <Layout onExit={options.onExit} />
              </SyncProvider>
            </PermissionsProvider>
          </MessagesProvider>
        </SessionProvider>
      </AgentProvider>
    </ErrorBoundary>
  ), {
    exitOnCtrlC: false,
    useMouse: true,
    consoleOptions: {
      onCopySelection: (text: string) => {
        copyToClipboard(text).then(() => {
          log.info("Copied selection to clipboard", { chars: text.length })
          showCopyConfirmation(text.length)
        }).catch((err: unknown) => {
          log.warn("Failed to copy selection to clipboard", {
            error: err instanceof Error ? err.message : String(err),
          })
        })
      },
      selectionColor: colors.bg.selection,
    },
  })
}
