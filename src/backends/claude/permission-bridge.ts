/**
 * Permission & Elicitation Bridge
 *
 * Bridges the SDK's canUseTool callback to the TUI's permission dialog
 * by converting tool permission requests and elicitation questions into
 * AgentEvents pushed through the EventChannel.
 */

import { log } from "../../utils/logger"
import type { AgentEvent } from "../../protocol/types"
import type { EventChannel } from "../../utils/event-channel"

// ---------------------------------------------------------------------------
// Types for bridging SDK <-> adapter
// ---------------------------------------------------------------------------

export interface PendingPermission {
  resolve: (result: PermissionResult) => void
  reject: (error: Error) => void
  toolName: string
  input: Record<string, unknown>
}

export type PermissionDecisionClassification = "user_temporary" | "user_permanent" | "user_reject"

export type PermissionResult = {
  behavior: "allow"
  updatedInput?: Record<string, unknown>
  updatedPermissions?: unknown[]
  toolUseID?: string
  decisionClassification?: PermissionDecisionClassification
} | {
  behavior: "deny"
  message: string
  interrupt?: boolean
  toolUseID?: string
  decisionClassification?: PermissionDecisionClassification
}

export interface PendingElicitation {
  resolve: (result: PermissionResult) => void
  reject: (error: Error) => void
}

// ---------------------------------------------------------------------------
// State interface — adapter passes its maps to these functions
// ---------------------------------------------------------------------------

export interface PermissionBridgeState {
  pendingPermissions: Map<string, PendingPermission>
  pendingElicitations: Map<string, PendingElicitation>
  pendingElicitationInputs: Map<string, Record<string, unknown>>
  sessionDeniedTools: Set<string>
  eventChannel: EventChannel<AgentEvent> | null
}

// ---------------------------------------------------------------------------
// canUseTool callback factory
// ---------------------------------------------------------------------------

export function createCanUseTool(state: PermissionBridgeState) {
  return async (
    toolName: string,
    input: Record<string, unknown>,
    options: any,
  ): Promise<PermissionResult> => {
    const id = options?.toolUseID ?? crypto.randomUUID()

    // Detect AskUserQuestion (elicitation)
    if (toolName === "AskUserQuestion") {
      return handleElicitation(id, input, state)
    }

    // Normal permission request
    return handlePermission(id, toolName, input, options, state)
  }
}

// ---------------------------------------------------------------------------
// Permission handling
// ---------------------------------------------------------------------------

export function handlePermission(
  id: string,
  toolName: string,
  input: Record<string, unknown>,
  options: any,
  state: PermissionBridgeState,
): Promise<PermissionResult> {
  // Check session-level denials before prompting
  if (state.sessionDeniedTools.has(toolName)) {
    log.debug("Permission auto-denied by session deny list", { tool: toolName })
    return Promise.resolve({
      behavior: "deny" as const,
      message: "Denied for session",
      toolUseID: id,
      decisionClassification: "user_reject" as const,
    })
  }

  return new Promise<PermissionResult>((resolve, reject) => {
    state.pendingPermissions.set(id, { resolve, reject, toolName, input })

    // Push permission_request to the event channel so the TUI sees it
    // immediately, even while the SDK is blocked waiting for canUseTool
    state.eventChannel?.push({
      type: "permission_request",
      id,
      tool: toolName,
      input,
      suggestions: options?.suggestions,
      displayName: options?.displayName,
      title: options?.title,
      description: options?.description,
      decisionReason: options?.decisionReason,
      blockedPath: options?.blockedPath,
    })
  })
}

// ---------------------------------------------------------------------------
// Elicitation handling
// ---------------------------------------------------------------------------

export function handleElicitation(
  id: string,
  input: Record<string, unknown>,
  state: PermissionBridgeState,
): Promise<PermissionResult> {
  return new Promise<PermissionResult>((resolve, reject) => {
    state.pendingElicitations.set(id, { resolve, reject })
    // Store original input so respondToElicitation can build updatedInput
    state.pendingElicitationInputs.set(id, input)

    // Parse AskUserQuestion input into ElicitationQuestion[]
    const questions = parseElicitationInput(input)

    // Push elicitation_request to the event channel so the TUI sees it
    // immediately, even while the SDK is blocked waiting for the callback
    state.eventChannel?.push({
      type: "elicitation_request",
      id,
      questions,
    })
  })
}

// ---------------------------------------------------------------------------
// Elicitation input parsing
// ---------------------------------------------------------------------------

export function parseElicitationInput(input: Record<string, unknown>): any[] {
  // AskUserQuestionInput has: { questions: [{ question, header, options: [{ label, description, preview? }], multiSelect }] }
  const questionsRaw = input.questions
  if (!Array.isArray(questionsRaw) || questionsRaw.length === 0) {
    // Fallback: try legacy single-question shape { question, options }
    const question = (input.question as string) ?? "Choose an option"
    const options = (input.options as any[]) ?? []
    return [
      {
        question,
        options: options.map((opt: any) => ({
          label: typeof opt === "string" ? opt : (opt.label ?? String(opt)),
          description: typeof opt === "object" ? opt.description : undefined,
          preview: typeof opt === "object" ? opt.preview : undefined,
        })),
        allowFreeText: true,
      },
    ]
  }

  return questionsRaw.map((q: any) => ({
    question: q.question ?? "Choose an option",
    header: q.header,
    options: (q.options ?? []).map((opt: any) => ({
      label: opt.label ?? String(opt),
      description: opt.description,
      preview: opt.preview,
    })),
    multiSelect: q.multiSelect ?? false,
    allowFreeText: true,
  }))
}
