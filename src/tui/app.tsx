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
  const width = () => dims()?.columns ?? 120
  const dashes = () => "─".repeat(Math.max(width(), 40))
  return (
    <box height={1} flexShrink={0}>
      <text color={244}>{dashes()}</text>
    </box>
  )
}

function ErrorFallback(props: { error: Error; reset: () => void }) {
  return (
    <box flexDirection="column" padding={2}>
      <text color="red" bold>
        Fatal Error
      </text>
      <text color="red">{props.error.message}</text>
      <text color="gray">Press Ctrl+D to exit.</text>
    </box>
  )
}

function Layout() {
  const { state: session } = useSession()
  const agent = useAgent()
  const sync = useSync()
  const { setState: setMessages } = useMessages()
  const renderer = useRenderer()

  /** Clean exit: suspend renderer, write trailing newline, close backend, exit. */
  function cleanExit(code: number) {
    try {
      renderer.suspend()
    } catch {
      // Renderer may already be gone — ignore
    }
    agent.backend.close()
    process.stdout.write("\n")
    process.exit(code)
  }

  // Global keyboard shortcuts
  useKeyboard((event) => {
    // Ctrl+D to exit (first press = graceful, second = force)
    if (event.ctrl && event.name === "d") {
      if (session.sessionState === "SHUTTING_DOWN") {
        cleanExit(130)
      }
      cleanExit(0)
    }

    // Ctrl+L to clear the conversation display
    if (event.ctrl && event.name === "l") {
      setMessages({ messages: [], streamingText: "", streamingThinking: "" })
      return
    }

    // Ctrl+C to interrupt during RUNNING, clear input during IDLE
    if (event.ctrl && event.name === "c") {
      if (
        session.sessionState === "RUNNING" ||
        session.sessionState === "WAITING_FOR_PERM" ||
        session.sessionState === "WAITING_FOR_ELIC"
      ) {
        sync.pushEvent({ type: "interrupt" })
        agent.backend.interrupt()
      } else if (session.sessionState === "IDLE" || session.sessionState === "ERROR") {
        // Clear input text; if already empty, show exit hint
        const hadText = clearInput()
        if (!hadText) {
          sync.pushEvent({ type: "system_message", text: "Use Ctrl+D to exit." })
        }
      }
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

export async function startApp(options: AppOptions): Promise<void> {
  const agentValue: AgentContextValue = {
    backend: options.backend,
    config: options.config,
  }

  await render(() => (
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
  ))
}
