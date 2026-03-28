/**
 * Root TUI Application
 *
 * Composes context providers and layout components.
 * Entry point for the SolidJS + OpenTUI rendering.
 */

import { render, useKeyboard, useRenderer } from "@opentui/solid"
import { ErrorBoundary, Show } from "solid-js"
import type { AgentBackend, SessionConfig } from "../protocol/types"
import { AgentProvider, useAgent, type AgentContextValue } from "./context/agent"
import { MessagesProvider, useMessages } from "./context/messages"
import { SessionProvider, useSession } from "./context/session"
import { PermissionsProvider } from "./context/permissions"
import { SyncProvider, useSync } from "./context/sync"
import { useTerminalDimensions } from "@opentui/solid"
import { ConversationView } from "./components/conversation"
import { InputArea, clearInput } from "./components/input-area"
import { StatusBar } from "./components/status-bar"
import { PermissionDialog } from "./components/permission-dialog"
import { ElicitationDialog } from "./components/elicitation"
import { HeaderBar } from "./components/header-bar"

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
      <text fg="red" attributes={1}>
        Fatal Error
      </text>
      <text fg="red">{props.error.message}</text>
      <text fg="gray">Press Ctrl+D to exit.</text>
    </box>
  )
}

function Layout() {
  const { state: session } = useSession()
  const agent = useAgent()
  const sync = useSync()
  const { setState: setMessages } = useMessages()

  // Counter-based rapid-press exit for Ctrl+D (3 presses within 1s)
  let ctrlDCount = 0
  let ctrlDTimer: ReturnType<typeof setTimeout> | undefined

  // Counter-based rapid-press exit for Ctrl+C on empty input (2 presses within 1s)
  let ctrlCEmptyCount = 0
  let ctrlCTimer: ReturnType<typeof setTimeout> | undefined

  const cleanExit = () => {
    agent.backend.close()
    process.exit(0)
  }

  // Global keyboard shortcuts
  useKeyboard((event) => {
    // Ctrl+D: 3+ rapid presses = exit, single/double = no effect
    if (event.ctrl && event.name === "d") {
      ctrlDCount++
      clearTimeout(ctrlDTimer)
      ctrlDTimer = setTimeout(() => { ctrlDCount = 0 }, 1000)

      if (ctrlDCount >= 3) {
        cleanExit()
      }
      // Single/double Ctrl+D = no effect
      return
    }

    // Ctrl+L to clear the conversation display
    if (event.ctrl && event.name === "l") {
      setMessages({ messages: [], streamingText: "", streamingThinking: "" })
      return
    }

    // Ctrl+C behavior:
    // - During RUNNING/WAITING: interrupt the current turn
    // - With text in input: clear the input
    // - Empty input, single press: no effect
    // - Empty input, 2 rapid presses: exit
    if (event.ctrl && event.name === "c") {
      if (
        session.sessionState === "RUNNING" ||
        session.sessionState === "WAITING_FOR_PERM" ||
        session.sessionState === "WAITING_FOR_ELIC"
      ) {
        sync.pushEvent({ type: "interrupt" })
        agent.backend.interrupt()
      } else {
        const hadText = clearInput()
        if (!hadText) {
          // Empty input — count rapid presses
          ctrlCEmptyCount++
          clearTimeout(ctrlCTimer)
          ctrlCTimer = setTimeout(() => { ctrlCEmptyCount = 0 }, 1000)
          if (ctrlCEmptyCount >= 2) {
            cleanExit()
          }
        } else {
          // Had text, cleared it — reset the empty counter
          ctrlCEmptyCount = 0
        }
      }
      return
    }
  })

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Header bar - fixed 1 line at top */}
      <HeaderBar />

      {/* Conversation area - fills available space, shrinks when terminal is small */}
      <box flexGrow={1} flexShrink={1} overflow="hidden">
        <ConversationView />
      </box>

      {/* Permission dialog (shown inline when WAITING_FOR_PERM) */}
      <PermissionDialog />

      {/* Elicitation dialog (shown inline when WAITING_FOR_ELIC) */}
      <ElicitationDialog />

      {/* Input area - Claude Code-style dash lines top and bottom */}
      <box flexShrink={0} flexDirection="column">
        <DashLine />
        <InputArea />
        <DashLine />
      </box>

      {/* Status bar - fixed 2 lines at bottom, never shrink */}
      <box flexShrink={0}>
        <StatusBar />
      </box>
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

  // Do NOT await render() — the OpenTUI native event loop keeps the process alive.
  // Awaiting would resolve immediately (render() only awaits createCliRenderer()),
  // causing main() to return and the process to exit.
  // Catch rejections to prevent unhandledRejection from killing the process.
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
                <Layout />
              </SyncProvider>
            </PermissionsProvider>
          </MessagesProvider>
        </SessionProvider>
      </AgentProvider>
    </ErrorBoundary>
  )).catch((err) => {
    console.error("Render error:", err)
    process.exit(1)
  })
}
