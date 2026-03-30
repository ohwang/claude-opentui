/**
 * Root TUI Application
 *
 * Composes context providers and layout components.
 * Entry point for the SolidJS + OpenTUI rendering.
 */

import { render, useKeyboard, useRenderer } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { ErrorBoundary, Show } from "solid-js"
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
      <text fg="#b2b2b2">{dashes()}</text>
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

function Layout() {
  const { state: session } = useSession()
  const agent = useAgent()
  const sync = useSync()
  // Counter-based rapid-press exit (matches Claude Code behavior)
  let ctrlDCount = 0
  let ctrlDTimer: ReturnType<typeof setTimeout> | undefined
  let ctrlCEmptyCount = 0
  let ctrlCTimer: ReturnType<typeof setTimeout> | undefined

  const cleanExit = (reason: string) => {
    log.info("Clean exit", { reason })
    agent.backend.close()
    process.stdout.write("\n")
    process.exit(0)
  }

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
        session.sessionState === "WAITING_FOR_ELIC"
      ) {
        sync.pushEvent({ type: "interrupt" })
        agent.backend.interrupt()
      } else {
        const hadText = clearInput()
        if (!hadText) {
          ctrlCEmptyCount++
          clearTimeout(ctrlCTimer)
          ctrlCTimer = setTimeout(() => { ctrlCEmptyCount = 0 }, 1000)
          if (ctrlCEmptyCount >= 2) {
            cleanExit("ctrl+c double-press")
          }
        } else {
          ctrlCEmptyCount = 0
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
        <StatusBar />
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
                <Layout />
              </SyncProvider>
            </PermissionsProvider>
          </MessagesProvider>
        </SessionProvider>
      </AgentProvider>
    </ErrorBoundary>
  ), { exitOnCtrlC: false })
}
