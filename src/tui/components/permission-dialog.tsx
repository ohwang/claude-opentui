/**
 * Permission Dialog — Claude Code-style inline permission prompt
 *
 * Renders within the conversation flow when WAITING_FOR_PERM.
 * Features:
 * - Periwinkle ─ borders (top and bottom)
 * - Action label header (displayName or tool name)
 * - Content preview (file path, command, etc.)
 * - Description subtitle when available
 * - 3-option radio selector with ↑/↓ arrow key navigation
 * - ❯ selection indicator with periwinkle accent
 * - Esc to cancel footer hint
 */

import { createSignal, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { usePermissions } from "../context/permissions"
import { useAgent } from "../context/agent"
import { useSession } from "../context/session"
import { useSync } from "../context/sync"
import path from "node:path"

// ANSI 153 = #afd7ff (periwinkle — Claude Code accent)
const ACCENT = "#afd7ff"
// ANSI 246 = #a8a8a8 (muted gray)
const MUTED = "#a8a8a8"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert absolute paths to relative (from cwd) for compact display */
function relativePath(absPath: string): string {
  const cwd = process.cwd()
  if (absPath.startsWith(cwd + "/")) {
    return absPath.slice(cwd.length + 1)
  }
  // Try home dir shorthand
  const home = process.env.HOME
  if (home && absPath.startsWith(home + "/")) {
    return "~/" + absPath.slice(home.length + 1)
  }
  return absPath
}

/** Extract the primary display content from tool input */
function extractContent(tool: string, input: unknown): { primary: string; secondary?: string } {
  const inp = input as Record<string, unknown> | null
  if (!inp) return { primary: "" }

  switch (tool) {
    case "Read": {
      const filePath = inp.file_path ? relativePath(String(inp.file_path)) : ""
      const extras: string[] = []
      if (inp.limit) extras.push(`limit: ${inp.limit}`)
      if (inp.offset) extras.push(`offset: ${inp.offset}`)
      return {
        primary: filePath,
        secondary: extras.length > 0 ? extras.join(", ") : undefined,
      }
    }
    case "Edit": {
      const filePath = inp.file_path ? relativePath(String(inp.file_path)) : ""
      return { primary: filePath }
    }
    case "Write": {
      const filePath = inp.file_path ? relativePath(String(inp.file_path)) : ""
      return { primary: filePath }
    }
    case "Bash": {
      const cmd = inp.command ? String(inp.command) : ""
      return { primary: cmd }
    }
    case "Glob": {
      const pattern = inp.pattern ? String(inp.pattern) : ""
      const dir = inp.path ? relativePath(String(inp.path)) : ""
      return { primary: pattern, secondary: dir ? `in ${dir}` : undefined }
    }
    case "Grep": {
      const pattern = inp.pattern ? String(inp.pattern) : ""
      const dir = inp.path ? relativePath(String(inp.path)) : ""
      return { primary: pattern, secondary: dir ? `in ${dir}` : undefined }
    }
    case "Agent": {
      const desc = inp.description ? String(inp.description) : ""
      const prompt = inp.prompt ? String(inp.prompt) : ""
      return { primary: desc || prompt.slice(0, 80) }
    }
    default: {
      // Try common field names
      if (inp.file_path) return { primary: relativePath(String(inp.file_path)) }
      if (inp.command) return { primary: String(inp.command) }
      if (inp.path) return { primary: relativePath(String(inp.path)) }
      try {
        const json = JSON.stringify(inp)
        return { primary: json.length > 120 ? json.slice(0, 117) + "..." : json }
      } catch {
        return { primary: String(inp) }
      }
    }
  }
}

/** Get a human-readable action label for the tool */
function actionLabel(tool: string, displayName?: string): string {
  if (displayName) return displayName
  switch (tool) {
    case "Read": return "Read file"
    case "Edit": return "Edit file"
    case "Write": return "Write file"
    case "Bash": return "Run command"
    case "Glob": return "Search files"
    case "Grep": return "Search content"
    case "Agent": return "Launch agent"
    case "WebFetch": return "Fetch URL"
    case "WebSearch": return "Web search"
    default: return tool
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PermissionDialog() {
  const { state } = usePermissions()
  const { state: session } = useSession()
  const agent = useAgent()
  const sync = useSync()
  const dims = useTerminalDimensions()

  // Radio selector state: 0 = Yes, 1 = Yes don't ask again, 2 = No
  const [selectedOption, setSelectedOption] = createSignal(0)

  // Reset selection when a new permission request arrives
  let lastPermId: string | null = null

  const borderLine = () => {
    const width = (dims()?.width ?? 120) - 4 // account for padding
    return "─".repeat(Math.max(width, 40))
  }

  useKeyboard((event) => {
    if (session.sessionState !== "WAITING_FOR_PERM") return
    if (!state.pendingPermission) return

    const id = state.pendingPermission.id
    const perm = state.pendingPermission

    // Reset selection on new permission request
    if (perm.id !== lastPermId) {
      lastPermId = perm.id
      setSelectedOption(0)
    }

    // Arrow key navigation
    if (event.name === "up") {
      setSelectedOption(Math.max(0, selectedOption() - 1))
      return
    }
    if (event.name === "down") {
      setSelectedOption(Math.min(2, selectedOption() + 1))
      return
    }

    // Number keys for direct selection
    if (event.name === "1") {
      setSelectedOption(0)
      approveOnce(id)
      return
    }
    if (event.name === "2") {
      setSelectedOption(1)
      approveAlways(id, perm)
      return
    }
    if (event.name === "3") {
      setSelectedOption(2)
      deny(id, perm.tool)
      return
    }

    // Enter confirms selected option
    if (event.name === "return") {
      const sel = selectedOption()
      if (sel === 0) approveOnce(id)
      else if (sel === 1) approveAlways(id, perm)
      else deny(id, perm.tool)
      return
    }

    // Legacy single-key shortcuts
    if (event.name === "y") {
      approveOnce(id)
      return
    }
    if (event.name === "a") {
      approveAlways(id, perm)
      return
    }
    if (event.name === "n" || event.name === "escape") {
      deny(id, perm.tool)
      return
    }
  })

  function approveOnce(id: string) {
    agent.backend.approveToolUse(id)
  }

  function approveAlways(id: string, perm: typeof state.pendingPermission & {}) {
    agent.backend.approveToolUse(id, {
      alwaysAllow: true,
      updatedPermissions: perm.suggestions,
    })
  }

  function deny(id: string, toolName: string) {
    agent.backend.denyToolUse(id, "Denied by user")
    sync.pushEvent({
      type: "system_message",
      text: `Tool "${toolName}" denied by user`,
    })
  }

  return (
    <Show when={state.pendingPermission}>
      {(perm) => {
        // Reset selection for new permission
        if (perm().id !== lastPermId) {
          lastPermId = perm().id
          setSelectedOption(0)
        }

        const label = () => actionLabel(perm().tool, perm().displayName)
        const content = () => extractContent(perm().tool, perm().input)
        const title = () => perm().title
        const description = () => perm().description

        return (
          <box flexDirection="column" paddingLeft={2} paddingRight={2}>
            {/* Top border */}
            <box height={1}>
              <text fg={ACCENT}>{borderLine()}</text>
            </box>

            {/* Action label */}
            <box height={1} paddingLeft={1} marginTop={0}>
              <text fg={ACCENT} attributes={TextAttributes.BOLD}>
                {label()}
              </text>
            </box>

            {/* Content preview (file path, command, etc.) */}
            <Show when={content().primary}>
              <box paddingLeft={3}>
                <text fg={MUTED}>{content().primary}</text>
              </box>
            </Show>
            <Show when={content().secondary}>
              <box paddingLeft={3}>
                <text fg={MUTED}>{content().secondary}</text>
              </box>
            </Show>

            {/* Description from SDK */}
            <Show when={description()}>
              <box paddingLeft={3} marginTop={0}>
                <text fg={MUTED}>{description()}</text>
              </box>
            </Show>

            {/* Title / question prompt */}
            <box height={1} paddingLeft={1} marginTop={1}>
              <text fg="white">
                {title() ?? "Do you want to proceed?"}
              </text>
            </box>

            {/* Option 1: Yes */}
            <box height={1} paddingLeft={1}>
              <Show when={selectedOption() === 0}
                fallback={
                  <text fg="white">{"  1. Yes"}</text>
                }
              >
                <text fg={ACCENT}>
                  {"\u276F 1. Yes"}
                </text>
              </Show>
            </box>

            {/* Option 2: Yes, and don't ask again */}
            <box height={1} paddingLeft={1}>
              <Show when={selectedOption() === 1}
                fallback={
                  <text fg="white" attributes={TextAttributes.BOLD}>
                    {"  2. Yes, and don\u2019t ask again for this tool"}
                  </text>
                }
              >
                <text fg={ACCENT} attributes={TextAttributes.BOLD}>
                  {"\u276F 2. Yes, and don\u2019t ask again for this tool"}
                </text>
              </Show>
            </box>

            {/* Option 3: No */}
            <box height={1} paddingLeft={1}>
              <Show when={selectedOption() === 2}
                fallback={
                  <text fg={MUTED}>{"  3. No"}</text>
                }
              >
                <text fg={ACCENT}>{"\u276F 3. No"}</text>
              </Show>
            </box>

            {/* Footer hints */}
            <box height={1} paddingLeft={1} marginTop={1}>
              <text fg={MUTED}>
                {"Esc to cancel"}
              </text>
            </box>

            {/* Bottom border */}
            <box height={1}>
              <text fg={ACCENT}>{borderLine()}</text>
            </box>
          </box>
        )
      }}
    </Show>
  )
}
