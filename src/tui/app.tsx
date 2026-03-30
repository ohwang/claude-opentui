/**
 * Root TUI Application
 *
 * Composes context providers and layout components.
 * Entry point for the SolidJS + OpenTUI rendering.
 */

import { render, useKeyboard, useRenderer } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { createSignal, createEffect, on, ErrorBoundary, Show } from "solid-js"
import type { AgentBackend, SessionConfig } from "../protocol/types"
import { log } from "../utils/logger"
import { AgentProvider, useAgent, type AgentContextValue } from "./context/agent"
import { MessagesProvider } from "./context/messages"
import { SessionProvider, useSession } from "./context/session"
import { PermissionsProvider } from "./context/permissions"
import { SyncProvider, useSync } from "./context/sync"
import { useTerminalDimensions } from "@opentui/solid"
import { ConversationView } from "./components/conversation"
import { InputArea, clearInput } from "./components/input-area"
import { StatusBar } from "./components/status-bar"
import { PermissionDialog } from "./components/permission-dialog"
import { ElicitationDialog } from "./components/elicitation"

/** Render a full-width dash separator line (Claude Code style) */
function DashLine() {
  const dims = useTerminalDimensions()
  const width = () => dims()?.width ?? 120
  const dashes = () => "─".repeat(Math.max(width(), 40))
  return (
    <box height={1} flexShrink={0}>
      <text fg="#808080">{dashes()}</text>
    </box>
  )
}

function ErrorFallback(props: { error: Error; reset: () => void }) {
  return (
    <box flexDirection="column" padding={2}>
      <text fg="red" attributes={TextAttributes.BOLD}>
        Fatal Error
      </text>
      <text fg="red">{props.error.message}</text>
      <text fg="gray">Press Ctrl+D to exit.</text>
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
  let statusHintTimer: ReturnType<typeof setTimeout> | undefined
  let interruptTimeout: ReturnType<typeof setTimeout> | undefined

  const renderer = useRenderer()

  const cleanExit = (reason: string) => {
    log.info("Clean exit", { reason })
    agent.backend.close()
    props.onExit?.()
    renderer.destroy()
    process.exit(0)
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

  // Global keyboard shortcuts
  useKeyboard((event) => {
    // Ctrl+D: single = no effect, 3+ rapid = exit
    if (event.ctrl && event.name === "d") {
      ctrlDCount++
      clearTimeout(ctrlDTimer)
      ctrlDTimer = setTimeout(() => { ctrlDCount = 0 }, 1000)
      if (ctrlDCount >= 3) {
        cleanExit("ctrl+d triple-press")
      }
      return
    }

    // Ctrl+L to clear the conversation display
    if (event.ctrl && event.name === "l") {
      sync.clearConversation()
      return
    }

    // Ctrl+C: text=clear, empty single=nothing, empty double=exit, running=interrupt
    if (event.ctrl && event.name === "c") {
      if (
        session.sessionState === "RUNNING" ||
        session.sessionState === "WAITING_FOR_PERM" ||
        session.sessionState === "WAITING_FOR_ELIC" ||
        session.sessionState === "INTERRUPTING"
      ) {
        if (session.sessionState === "INTERRUPTING") {
          // Already interrupting \u2014 show hint about force exit
          setStatusHint("Interrupt pending... Press Ctrl+D\u00D73 to force exit")
          clearTimeout(statusHintTimer)
          statusHintTimer = setTimeout(() => setStatusHint(null), 3000)
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
          ctrlCTimer = setTimeout(() => { ctrlCEmptyCount = 0 }, 2000)
          if (ctrlCEmptyCount >= 2) {
            cleanExit("ctrl+c double-press")
          } else {
            // Show "Press Ctrl-C again to exit" hint in status bar
            setStatusHint("Press Ctrl-C again to exit")
            clearTimeout(statusHintTimer)
            statusHintTimer = setTimeout(() => setStatusHint(null), 2000)
          }
        } else {
          ctrlCEmptyCount = 0
          setStatusHint(null)
        }
      }
    }
  })

  return (
    <box flexDirection="column" width="100%" height="100%">
      <ConversationView>
        {/* Permission dialog (shown inline when WAITING_FOR_PERM) */}
        <PermissionDialog />

        {/* Elicitation dialog (shown inline when WAITING_FOR_ELIC) */}
        <ElicitationDialog />

        {/* Input area - Claude Code-style dash lines top and bottom */}
        <DashLine />
        <InputArea />
        <DashLine />

        {/* Status bar */}
        <StatusBar hint={statusHint()} />
      </ConversationView>
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
  ), { exitOnCtrlC: false })
}
