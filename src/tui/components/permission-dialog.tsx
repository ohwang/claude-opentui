/**
 * Permission Dialog — Claude Code-style inline permission prompt
 *
 * Renders within the conversation flow when WAITING_FOR_PERM.
 * Features:
 * - Top ─ border, content preview between ╌ dashed borders
 * - Action label header (displayName or tool name)
 * - File/command content preview with line numbers
 * - 3-option radio selector with ↑/↓ arrow key navigation
 * - ❯ selection indicator with periwinkle accent
 * - Context-specific question and option text from SDK metadata
 * - Esc to cancel · Tab to amend · ctrl+e to explain footer hints
 */

import { createSignal, Show, For } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { usePermissions } from "../context/permissions"
import { useAgent } from "../context/agent"
import { useSession } from "../context/session"
import { useSync } from "../context/sync"
import type { PermissionRequestEvent } from "../../protocol/types"

// ANSI 153 = #afd7ff (periwinkle — Claude Code accent)
const ACCENT = "#afd7ff"
// ANSI 246 = #a8a8a8 (muted gray)
const MUTED = "#a8a8a8"

// Max lines to show in content preview
const MAX_PREVIEW_LINES = 20

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert absolute paths to relative (from cwd) for compact display */
function relativePath(absPath: string): string {
  const cwd = process.cwd()
  if (absPath.startsWith(cwd + "/")) {
    return absPath.slice(cwd.length + 1)
  }
  // For paths outside cwd, compute relative
  const rel = require("node:path").relative(cwd, absPath)
  // If the relative path is too deep, just show the filename
  const upCount = (rel.match(/\.\.\//g) || []).length
  if (upCount > 2) {
    return require("node:path").basename(absPath)
  }
  return rel
}

/** Extract the filename from a path */
function fileName(filePath: string): string {
  const parts = filePath.split("/")
  return parts[parts.length - 1] || filePath
}

/** Extract the parent directory name from a path */
function parentDir(filePath: string): string {
  const parts = filePath.replace(/\/$/, "").split("/")
  return parts[parts.length - 1] || filePath
}

/** Get a human-readable action label for the tool */
function actionLabel(tool: string, displayName?: string): string {
  if (displayName) return displayName
  switch (tool) {
    case "Read": return "Read file"
    case "Edit": return "Edit file"
    case "Write": return "Create file"
    case "Bash": return "Bash command"
    case "Glob": return "Search files"
    case "Grep": return "Search content"
    case "Agent": return "Launch agent"
    case "WebFetch": return "Fetch URL"
    case "WebSearch": return "Web search"
    default: return tool
  }
}

/** Extract path string from tool input */
function extractPath(tool: string, input: unknown): string {
  const inp = input as Record<string, unknown> | null
  if (!inp) return ""
  if (inp.file_path) return relativePath(String(inp.file_path))
  if (inp.command) return String(inp.command)
  if (inp.pattern) {
    const dir = inp.path ? relativePath(String(inp.path)) : ""
    return `${inp.pattern}${dir ? ` in ${dir}` : ""}`
  }
  if (inp.path) return relativePath(String(inp.path))
  return ""
}

/** Extract content lines for preview (Write content, Edit diff, Bash command) */
function extractPreviewLines(tool: string, input: unknown): string[] | null {
  const inp = input as Record<string, unknown> | null
  if (!inp) return null

  switch (tool) {
    case "Write": {
      const content = inp.content
      if (typeof content === "string" && content.trim()) {
        return content.split("\n").slice(0, MAX_PREVIEW_LINES)
      }
      return null
    }
    case "Edit": {
      // Show the new_string as preview (what will be written)
      const newStr = inp.new_string
      if (typeof newStr === "string" && newStr.trim()) {
        return newStr.split("\n").slice(0, MAX_PREVIEW_LINES)
      }
      return null
    }
    case "Bash": {
      const cmd = inp.command
      if (typeof cmd === "string" && cmd.trim()) {
        return cmd.split("\n").slice(0, MAX_PREVIEW_LINES)
      }
      return null
    }
    default:
      return null
  }
}

/** Build the question text from SDK title or tool context */
function questionText(perm: PermissionRequestEvent): string {
  if (perm.title) return perm.title
  const inp = perm.input as Record<string, unknown> | null
  const filePath = inp?.file_path ? String(inp.file_path) : ""
  const name = filePath ? fileName(filePath) : ""
  switch (perm.tool) {
    case "Write": return name ? `Do you want to create ${name}?` : "Do you want to proceed?"
    case "Edit": return name ? `Do you want to edit ${name}?` : "Do you want to proceed?"
    case "Bash": return "Do you want to run this command?"
    default: return "Do you want to proceed?"
  }
}

/** Build option 2 text from SDK suggestions or derive from context */
function option2Text(perm: PermissionRequestEvent): string {
  // Try to derive from suggestions
  if (perm.suggestions && perm.suggestions.length > 0) {
    const s = perm.suggestions[0]
    if ((s.type === "addRules" || s.type === "replaceRules") && s.rules?.[0]?.toolName) {
      return `Yes, and don\u2019t ask again for ${s.rules[0].toolName} (shift+tab)`
    }
    if (s.type === "addDirectories" && s.directories?.length > 0) {
      const dir = parentDir(s.directories[0])
      return `Yes, allow all edits in ${dir}/ during this session (shift+tab)`
    }
  }
  // Derive from tool and path context
  const inp = perm.input as Record<string, unknown> | null
  const filePath = inp?.file_path ? String(inp.file_path) : ""
  if (filePath) {
    const parts = filePath.split("/")
    const dir = parts.length > 1 ? parts[parts.length - 2] : ""
    if (dir && dir !== ".") {
      return `Yes, allow all edits in ${dir}/ during this session (shift+tab)`
    }
  }
  return `Yes, and don\u2019t ask again for this tool`
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

  const dashedLine = () => {
    const width = (dims()?.width ?? 120) - 4 // account for padding
    return "\u254C".repeat(Math.max(width, 40))
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
    // Use SDK-provided suggestions if available, otherwise generate fallback
    // (matches claude-go behavior: always send updatedPermissions for "always allow")
    const permissions = (perm.suggestions && perm.suggestions.length > 0)
      ? perm.suggestions
      : [{
          type: "addRules" as const,
          rules: [{ toolName: perm.tool }],
          behavior: "allow" as const,
          destination: "session" as const,
        }]

    agent.backend.approveToolUse(id, {
      alwaysAllow: true,
      updatedPermissions: permissions,
    })
  }

  function deny(id: string, toolName: string) {
    agent.backend.denyToolUse(id, "User denied")
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
        const previewLines = () => extractPreviewLines(perm().tool, perm().input)
        // Don't show path separately for Bash (command is shown in preview)
        const pathStr = () => {
          if (perm().tool === "Bash" && previewLines()) return ""
          return extractPath(perm().tool, perm().input)
        }
        const question = () => questionText(perm())
        const opt2 = () => option2Text(perm())
        const description = () => perm().description

        return (
          <box flexDirection="column" paddingLeft={1} paddingRight={1}>
            {/* Action label */}
            <box height={1} paddingLeft={1}>
              <text fg={ACCENT} attributes={TextAttributes.BOLD}>
                {label()}
              </text>
            </box>

            {/* Path / primary content info */}
            <Show when={pathStr()}>
              <box paddingLeft={1}>
                <text fg={MUTED}>{pathStr()}</text>
              </box>
            </Show>

            {/* Description from SDK */}
            <Show when={description()}>
              <box paddingLeft={1}>
                <text fg={MUTED}>{description()}</text>
              </box>
            </Show>

            {/* Content preview between ╌ dashed borders */}
            <Show when={previewLines()}>
              {(lines) => (
                <box flexDirection="column">
                  <box height={1}>
                    <text fg={ACCENT}>{dashedLine()}</text>
                  </box>
                  <For each={lines()}>
                    {(line, idx) => (
                      <box height={1} paddingLeft={2}>
                        <text fg="white">{`${String(idx() + 1).padStart(3, " ")} ${line || " "}`}</text>
                      </box>
                    )}
                  </For>
                  <box height={1}>
                    <text fg={ACCENT}>{dashedLine()}</text>
                  </box>
                </box>
              )}
            </Show>

            {/* Question prompt */}
            <box height={1} paddingLeft={1} marginTop={previewLines() ? 0 : 1}>
              <text fg="white">
                {question()}
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
                    {"  2. " + opt2()}
                  </text>
                }
              >
                <text fg={ACCENT} attributes={TextAttributes.BOLD}>
                  {"\u276F 2. " + opt2()}
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
                {"Esc to cancel \u00B7 Tab to amend \u00B7 ctrl+e to explain"}
              </text>
            </box>
          </box>
        )
      }}
    </Show>
  )
}
