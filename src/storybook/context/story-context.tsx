/**
 * StoryContextProvider — wraps a story's render() output with the
 * full context provider stack, seeded with mock values.
 *
 * Uses all real providers except SyncProvider (replaced with NoopSyncProvider
 * that never starts an event loop).
 */

import { type ParentProps } from "solid-js"
import type { StoryContext } from "../types"
import { NoopBackend } from "../fixtures/backend"
import { AgentProvider, type AgentContextValue } from "../../tui/context/agent"
import { SessionProvider, useSession } from "../../tui/context/session"
import { MessagesProvider, useMessages } from "../../tui/context/messages"
import { PermissionsProvider, usePermissions } from "../../tui/context/permissions"
import { SyncContext, type SyncContextValue } from "../../tui/context/sync"
import { AnimationProvider } from "../../tui/context/animation"
import { ToastProvider } from "../../tui/context/toast"
import { ModalProvider } from "../../tui/context/modal"

function NoopSyncProvider(props: ParentProps) {
  const value: SyncContextValue = {
    pushEvent: () => {},
    startEventLoop: () => {},
    clearConversation: () => {},
    resetCost: () => {},
  }
  return (
    <SyncContext.Provider value={value}>
      {props.children}
    </SyncContext.Provider>
  )
}

/** Runs inside the provider tree to seed stores with story overrides on mount */
function StoryContextOverrides(props: ParentProps<{ context?: StoryContext }>) {
  const session = useSession()
  const messages = useMessages()
  const permissions = usePermissions()

  if (props.context?.session) session.setState(props.context.session)
  if (props.context?.messages) messages.setState(props.context.messages)
  if (props.context?.permissions) permissions.setState(props.context.permissions)

  return <>{props.children}</>
}

export function StoryContextProvider(props: ParentProps<{ context?: StoryContext }>) {
  const agentValue: AgentContextValue = {
    backend: props.context?.agent?.backend ?? new NoopBackend(),
    config: { cwd: process.cwd(), ...props.context?.agent?.config },
  }

  return (
    <AgentProvider value={agentValue}>
      <SessionProvider>
        <MessagesProvider>
          <PermissionsProvider>
            <NoopSyncProvider>
              <AnimationProvider>
                <ToastProvider>
                  <ModalProvider>
                    <StoryContextOverrides context={props.context}>
                      {props.children}
                    </StoryContextOverrides>
                  </ModalProvider>
                </ToastProvider>
              </AnimationProvider>
            </NoopSyncProvider>
          </PermissionsProvider>
        </MessagesProvider>
      </SessionProvider>
    </AgentProvider>
  )
}
