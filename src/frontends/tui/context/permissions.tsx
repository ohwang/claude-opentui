/**
 * Permissions Context — Permission + elicitation state
 *
 * Tracks pending permission requests and elicitation dialogs.
 */

import {
  createContext,
  useContext,
  type ParentProps,
} from "solid-js"
import { createStore, type SetStoreFunction } from "solid-js/store"
import type {
  PermissionRequestEvent,
  ElicitationRequestEvent,
} from "../../../protocol/types"

export interface PermissionsState {
  pendingPermission: PermissionRequestEvent | null
  pendingElicitation: ElicitationRequestEvent | null
}

export interface PermissionsContextValue {
  state: PermissionsState
  setState: SetStoreFunction<PermissionsState>
}

export const PermissionsContext = createContext<PermissionsContextValue>()

export function PermissionsProvider(props: ParentProps) {
  const [state, setState] = createStore<PermissionsState>({
    pendingPermission: null,
    pendingElicitation: null,
  })

  return (
    <PermissionsContext.Provider value={{ state, setState }}>
      {props.children}
    </PermissionsContext.Provider>
  )
}

export function usePermissions(): PermissionsContextValue {
  const ctx = useContext(PermissionsContext)
  if (!ctx)
    throw new Error("usePermissions must be used within PermissionsProvider")
  return ctx
}
