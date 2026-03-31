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
  /** Getter function — must resolve at call time, not capture time.
   *  The event channel is created lazily in iterateQuery(), after
   *  buildOptions() snapshots the bridge state, so a plain field
   *  would freeze at `null`.  */
  getEventChannel: () => EventChannel<AgentEvent> | null
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
    log.info("canUseTool callback invoked", {
      toolName,
      id,
      isElicitation: toolName === "AskUserQuestion",
      hasOptions: !!options,
      inputKeys: Object.keys(input).join(","),
    })

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

  const channel = state.getEventChannel()
  if (!channel) {
    log.warn("Permission request dropped: event channel not ready", { tool: toolName })
    return Promise.resolve({
      behavior: "deny" as const,
      message: "Event channel not initialized",
    })
  }

  return new Promise<PermissionResult>((resolve, reject) => {
    state.pendingPermissions.set(id, { resolve, reject, toolName, input })

    // Push permission_request to the event channel so the TUI sees it
    // immediately, even while the SDK is blocked waiting for canUseTool
    channel.push({
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
  const channel = state.getEventChannel()
  if (!channel) {
    log.warn("Elicitation request dropped: event channel not ready", { tool: "AskUserQuestion" })
    return Promise.resolve({
      behavior: "deny" as const,
      message: "Event channel not initialized",
    })
  }

  return new Promise<PermissionResult>((resolve, reject) => {
    state.pendingElicitations.set(id, { resolve, reject })
    // Store original input so respondToElicitation can build updatedInput
    state.pendingElicitationInputs.set(id, input)

    // Parse AskUserQuestion input into ElicitationQuestion[]
    const questions = parseElicitationInput(input)

    // Push elicitation_request to the event channel so the TUI sees it
    // immediately, even while the SDK is blocked waiting for the callback
    channel.push({
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

  const parsed = questionsRaw.map((q: any) => {
    const options = (q.options ?? []).map((opt: any) => ({
      label: opt.label ?? String(opt),
      description: opt.description,
      preview: opt.preview,
    }))
    let allowFreeText = q.allowFreeText ?? true
    // Safety: if no options and free text is disabled, enable free text
    // so the user has some way to respond
    if (options.length === 0 && !allowFreeText) {
      log.warn("Elicitation question has no options and allowFreeText=false; forcing allowFreeText=true", {
        question: q.question,
      })
      allowFreeText = true
    }
    return {
      question: q.question ?? "Choose an option",
      header: q.header,
      options,
      multiSelect: q.multiSelect ?? false,
      allowFreeText,
    }
  })

  // If all questions were filtered out somehow, add a fallback
  if (parsed.length === 0) {
    const fallbackText = (input.question as string) ?? (input.text as string) ?? "No questions provided"
    log.warn("Elicitation had empty questions array after parsing; adding fallback question", {
      fallbackText,
    })
    parsed.push({
      question: fallbackText,
      header: undefined,
      options: [],
      multiSelect: false,
      allowFreeText: true,
    })
  }

  return parsed
}
