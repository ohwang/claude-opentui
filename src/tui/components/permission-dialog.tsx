/**
 * Permission Dialog — Claude Code-style inline permission prompt
 *
 * Renders within the conversation flow when WAITING_FOR_PERM.
 * Features:
 * - Action label header (displayName or tool name)
 * - File/command content preview between dashed borders
 * - Color-coded diff preview for Edit operations (red/green)
 * - 4-option radio selector: Allow (y), Always allow (a), Deny (n), Deny for session (d)
 * - Wrap-around arrow key + Tab navigation (matching claude-go)
 * - ❯ selection indicator with periwinkle accent
 * - Context-specific question and option text from SDK metadata/suggestions
 * - Esc to cancel, Enter to confirm, y/a/n/d single-key shortcuts
 * - "Deny for session" tracks tool name in adapter for auto-deny on future calls
 */

import { createSignal, createEffect, createMemo, Show, For } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { usePermissions } from "../context/permissions"
import { useAgent } from "../context/agent"
import { useSession } from "../context/session"
import { useSync } from "../context/sync"
import { colors } from "../theme/tokens"
import type { PermissionRequestEvent, PermissionUpdate } from "../../protocol/types"

// Semantic aliases from design system tokens
const ACCENT = colors.border.accent
const MUTED = colors.text.secondary
const DIFF_ADDED = colors.diff.added
const DIFF_REMOVED = colors.diff.removed

// Max lines to show in content preview
const MAX_PREVIEW_LINES = 20

// Max characters to process from input content before splitting into lines.
// Prevents multi-megabyte payloads from freezing the TUI during string splitting.
const MAX_CONTENT_CHARS = 10_000

// Max characters per preview line before truncation
const MAX_LINE_LENGTH = 200

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
  if (typeof inp.file_path === "string" && inp.file_path) return relativePath(inp.file_path)
  if (typeof inp.command === "string" && inp.command) return inp.command
  if (inp.pattern) {
    const dir = inp.path ? relativePath(String(inp.path)) : ""
    return `${inp.pattern}${dir ? ` in ${dir}` : ""}`
  }
  if (inp.path) return relativePath(String(inp.path))
  return ""
}

/** A preview line with optional diff prefix for coloring */
interface PreviewLine {
  text: string
  /** "+" for added, "-" for removed, " " for context/neutral */
  prefix?: "+" | "-" | " "
}

/** Cap a string to MAX_CONTENT_CHARS to prevent expensive splitting */
function capContent(s: string): string {
  return s.length > MAX_CONTENT_CHARS ? s.slice(0, MAX_CONTENT_CHARS) : s
}

/** Truncate a single line to MAX_LINE_LENGTH */
function capLine(rawLine: string): string {
  return rawLine.length > MAX_LINE_LENGTH ? rawLine.slice(0, MAX_LINE_LENGTH - 3) + "..." : rawLine
}

function extractPreviewLines(tool: string, input: unknown): PreviewLine[] | null {
  const inp = input as Record<string, unknown> | null
  if (!inp) return null

  switch (tool) {
    case "Write": {
      const content = inp.content
      if (typeof content === "string" && content.trim()) {
        return capContent(content).split("\n").map(l => ({ text: capLine(l), prefix: "+" as const }))
      }
      return null
    }
    case "Edit": {
      // Show old_string (removed) and new_string (added) as diff
      const oldStr = inp.old_string
      const newStr = inp.new_string
      const lines: PreviewLine[] = []
      if (typeof oldStr === "string" && oldStr.trim()) {
        for (const l of capContent(oldStr).split("\n")) {
          lines.push({ text: capLine(l), prefix: "-" })
        }
      }
      if (typeof newStr === "string" && newStr.trim()) {
        for (const l of capContent(newStr).split("\n")) {
          lines.push({ text: capLine(l), prefix: "+" })
        }
      }
      return lines.length > 0 ? lines : null
    }
    case "Bash": {
      const cmd = inp.command
      if (typeof cmd === "string" && cmd.trim()) {
        return capContent(cmd).split("\n").map(l => ({ text: capLine(l) }))
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

/** Build option 2 text from SDK suggestions or derive from context.
 *
 * Always uses `perm.tool` as the authoritative tool name — suggestions may
 * reference a different tool (e.g. a parent category), which caused Bug #1
 * where the label showed "Always allow Read" for a Bash tool.
 */
function option2Text(perm: PermissionRequestEvent): string {
  // Check if suggestions include an addDirectories entry
  if (perm.suggestions && perm.suggestions.length > 0) {
    for (const s of perm.suggestions) {
      if (s.type === "addDirectories" && s.directories.length > 0 && s.directories[0]) {
        const dir = parentDir(s.directories[0])
        return `Always allow in ${dir}/`
      }
    }
  }
  // Use the actual tool name — never derive from suggestions[].rules[].toolName
  return `Always allow ${perm.tool}`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// Number of options in the permission dialog
const NUM_OPTIONS = 4

export function PermissionDialog() {
  const { state } = usePermissions()
  const { state: session } = useSession()
  const agent = useAgent()
  const sync = useSync()
  const dims = useTerminalDimensions()

  // Radio selector state: 0 = Allow, 1 = Always allow, 2 = Deny, 3 = Deny for session
  const [selectedOption, setSelectedOption] = createSignal(0)

  // Reset selection when a new permission request arrives
  let lastPermId: string | null = null

  // Guard against buffered keystrokes leaking into the NEXT permission dialog.
  // After approving/denying, ignore all keystrokes for 200ms to prevent rapid
  // "a" + "d" typing from accidentally denying the next permission request.
  let justActed = false
  let justActedTimer: ReturnType<typeof setTimeout> | undefined

  function markActed() {
    justActed = true
    clearTimeout(justActedTimer)
    justActedTimer = setTimeout(() => { justActed = false }, 200)
  }

  // Reset debounce when a new permission request arrives so the new dialog
  // is immediately responsive, even if it appears within 200ms of the last one.
  let lastDebouncePermId = ""
  createEffect(() => {
    const currentId = state.pendingPermission?.id ?? ""
    if (currentId && currentId !== lastDebouncePermId) {
      lastDebouncePermId = currentId
      justActed = false
    }
  })

  const dashedLine = () => {
    const width = (dims()?.width ?? 120) - 4 // account for padding
    return "\u254C".repeat(Math.max(width, 40))
  }

  useKeyboard((event) => {
    if (session.sessionState !== "WAITING_FOR_PERM") return
    if (!state.pendingPermission) return

    // Ignore buffered keystrokes that arrive shortly after an action.
    // This prevents a rapid "a" then "d" from denying the NEXT permission.
    if (justActed) return

    const id = state.pendingPermission.id
    const perm = state.pendingPermission

    // Reset selection on new permission request
    if (perm.id !== lastPermId) {
      lastPermId = perm.id
      setSelectedOption(0)
    }

    // Arrow key navigation (wraps around, matching claude-go)
    if (event.name === "up") {
      setSelectedOption((selectedOption() - 1 + NUM_OPTIONS) % NUM_OPTIONS)
      return
    }
    if (event.name === "down") {
      setSelectedOption((selectedOption() + 1) % NUM_OPTIONS)
      return
    }

    // Tab / Shift+Tab navigation (matching claude-go)
    if (event.name === "tab") {
      setSelectedOption((selectedOption() + 1) % NUM_OPTIONS)
      return
    }

    // Number keys for direct selection + immediate action
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
    if (event.name === "4") {
      setSelectedOption(3)
      denyForSession(id, perm.tool)
      return
    }

    // Enter confirms selected option
    if (event.name === "return") {
      const sel = selectedOption()
      if (sel === 0) approveOnce(id)
      else if (sel === 1) approveAlways(id, perm)
      else if (sel === 2) deny(id, perm.tool)
      else denyForSession(id, perm.tool)
      return
    }

    // Single-key shortcuts (matching claude-go: y/a/n/d)
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
    if (event.name === "d") {
      denyForSession(id, perm.tool)
      return
    }
  })

  function approveOnce(id: string) {
    markActed()
    agent.backend.approveToolUse(id)
  }

  function approveAlways(id: string, perm: typeof state.pendingPermission & {}) {
    markActed()
    // Build updatedPermissions for "always allow":
    // 1. Include SDK suggestions if available (echoed back per SDK docs).
    //    These may be command-specific (e.g., Bash "ls:*") and are persisted
    //    to localSettings by the CLI.
    // 2. Always include a tool-wide rule (no ruleContent) at session scope.
    //    This ensures the CLI's JTY → wTY check auto-allows ALL subsequent
    //    calls to the same tool for the rest of the session, not just the
    //    specific command pattern in the suggestions.
    const permissions: PermissionUpdate[] = []

    // Echo SDK suggestions (command-specific, persisted to localSettings)
    if (perm.suggestions && perm.suggestions.length > 0) {
      permissions.push(...perm.suggestions)
    }

    // Always add a tool-wide session rule so wTY matches on next call.
    // Without this, the suggestions' ruleContent-based matching only
    // covers the specific command/file pattern, not the tool in general.
    const hasToolWideRule = permissions.some(
      (p) =>
        (p.type === "addRules" || p.type === "replaceRules") &&
        p.rules.some((r) => r.toolName === perm.tool && !r.ruleContent),
    )
    if (!hasToolWideRule) {
      permissions.push({
        type: "addRules" as const,
        rules: [{ toolName: perm.tool }],
        behavior: "allow" as const,
        destination: "session" as const,
      })
    }

    agent.backend.approveToolUse(id, {
      alwaysAllow: true,
      updatedPermissions: permissions,
    })
  }

  function deny(id: string, toolName: string) {
    markActed()
    agent.backend.denyToolUse(id, "User denied")
    sync.pushEvent({
      type: "system_message",
      text: `Tool "${toolName}" denied by user`,
    })
  }

  function denyForSession(id: string, toolName: string) {
    markActed()
    agent.backend.denyToolUse(id, "Denied for session", { denyForSession: true })
    sync.pushEvent({
      type: "system_message",
      text: `Tool "${toolName}" denied for session`,
    })
  }

  return (
    <Show when={state.pendingPermission}>
      {(perm) => {
        const label = () => actionLabel(perm().tool, perm().displayName)
        const allPreviewLines = createMemo(() => extractPreviewLines(perm().tool, perm().input))

        // Viewport-aware preview truncation.
        // Reserve lines for chrome: action label (1) + path (1) + description (1)
        // + dashed borders (2) + question (1) + 4 options (4) + footer+margin (2)
        // + padding (2) + truncation indicator (1) = ~15 lines.
        const CHROME_LINES = 15
        const maxPreviewLines = () => {
          const termHeight = dims()?.height ?? 80
          const available = termHeight - CHROME_LINES
          // Always show at least 3 lines of preview, cap at MAX_PREVIEW_LINES
          return Math.max(3, Math.min(available, MAX_PREVIEW_LINES))
        }

        const previewLines = () => {
          const all = allPreviewLines()
          if (!all) return null
          const max = maxPreviewLines()
          return all.length > max ? all.slice(0, max) : all
        }

        const truncatedCount = () => {
          const all = allPreviewLines()
          if (!all) return 0
          const max = maxPreviewLines()
          return Math.max(0, all.length - max)
        }

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

            {/* Content preview between dashed borders */}
            <Show when={previewLines()}>
              {(lines) => (
                <box flexDirection="column">
                  <box height={1}>
                    <text fg={ACCENT}>{dashedLine()}</text>
                  </box>
                  <For each={lines()}>
                    {(line, idx) => {
                      const lineColor = () => {
                        if (line.prefix === "+") return DIFF_ADDED
                        if (line.prefix === "-") return DIFF_REMOVED
                        return "white"
                      }
                      const prefixChar = () => line.prefix ?? " "
                      return (
                        <box height={1} paddingLeft={2}>
                          <text fg={lineColor()}>{`${prefixChar()} ${line.text || " "}`}</text>
                        </box>
                      )
                    }}
                  </For>
                  <Show when={truncatedCount() > 0}>
                    <box height={1} paddingLeft={2}>
                      <text fg={MUTED}>{`... ${truncatedCount()} more line${truncatedCount() === 1 ? "" : "s"}`}</text>
                    </box>
                  </Show>
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

            {/* Option 1: Allow (y) */}
            <box height={1} paddingLeft={1}>
              <Show when={selectedOption() === 0}
                fallback={
                  <text fg="white">{"  y. Allow"}</text>
                }
              >
                <text fg={ACCENT}>
                  {"\u276F y. Allow"}
                </text>
              </Show>
            </box>

            {/* Option 2: Always allow (a) */}
            <box height={1} paddingLeft={1}>
              <Show when={selectedOption() === 1}
                fallback={
                  <text fg="white" attributes={TextAttributes.BOLD}>
                    {"  a. " + opt2()}
                  </text>
                }
              >
                <text fg={ACCENT} attributes={TextAttributes.BOLD}>
                  {"\u276F a. " + opt2()}
                </text>
              </Show>
            </box>

            {/* Option 3: Deny (n) */}
            <box height={1} paddingLeft={1}>
              <Show when={selectedOption() === 2}
                fallback={
                  <text fg={MUTED}>{"  n. Deny"}</text>
                }
              >
                <text fg={ACCENT}>{"\u276F n. Deny"}</text>
              </Show>
            </box>

            {/* Option 4: Deny for session (d) */}
            <box height={1} paddingLeft={1}>
              <Show when={selectedOption() === 3}
                fallback={
                  <text fg={MUTED}>{"  d. Deny for session"}</text>
                }
              >
                <text fg={ACCENT}>{"\u276F d. Deny for session"}</text>
              </Show>
            </box>

            {/* Footer hints */}
            <box height={1} paddingLeft={1} marginTop={1}>
              <text fg={MUTED}>
                {"\u2191\u2193 navigate \u00B7 y/a/n/d shortcut \u00B7 Enter to confirm"}
              </text>
            </box>
          </box>
        )
      }}
    </Show>
  )
}
