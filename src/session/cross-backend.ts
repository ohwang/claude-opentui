/**
 * Cross-Backend Session Resume
 *
 * Enables resuming a session from one backend using a different backend.
 * E.g., `--backend codex --resume <claude-session-id>` loads the Claude
 * session's conversation history and injects it as context into Codex.
 *
 * Flow:
 *   1. detectSessionOrigin() — check if session ID belongs to a known backend
 *   2. readForeignSession() — read session data into Block[]
 *   3. formatFullHistory() — convert Block[] to a full-text prompt for injection
 *
 * Supports reading sessions from Claude (JSONL), Codex (JSONL), and
 * Gemini (JSON) session files on disk.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, basename } from "node:path"
import { log } from "../utils/logger"
import {
  getSessionFilePath,
  readSessionHistory,
} from "../backends/claude/session-reader"
import type { Block, SessionInfo, ToolStatus } from "../protocol/types"

/** Known backend names that can originate sessions */
export type SessionOrigin = "claude" | "codex" | "gemini" | null

// ---------------------------------------------------------------------------
// Home directory helper
// ---------------------------------------------------------------------------

function homeDir(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? "~"
}

// ---------------------------------------------------------------------------
// Codex session file paths: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
// ---------------------------------------------------------------------------

/** Get the Codex sessions root directory */
function codexSessionsDir(): string {
  return join(homeDir(), ".codex", "sessions")
}

/**
 * Recursively find all .jsonl files under a directory.
 * Returns absolute paths.
 */
function findJsonlFiles(dir: string): string[] {
  const results: string[] = []
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...findJsonlFiles(fullPath))
      } else if (entry.name.endsWith(".jsonl")) {
        results.push(fullPath)
      }
    }
  } catch {
    // Directory doesn't exist or not readable
  }
  return results
}

/**
 * Find a Codex session file by session ID.
 * Codex session filenames contain the UUID: rollout-TIMESTAMP-UUID.jsonl
 */
function findCodexSessionFile(sessionId: string): string | null {
  const root = codexSessionsDir()
  if (!existsSync(root)) return null

  const files = findJsonlFiles(root)
  for (const file of files) {
    const name = basename(file)
    if (name.includes(sessionId)) {
      return file
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Gemini session file paths: ~/.gemini/tmp/<project>/chats/session-*.json
//
// Gemini CLI maps each project root to a short identifier via
// ~/.gemini/projects.json (e.g. /Users/x/dev/repo -> "repo"). Sessions are
// stored under ~/.gemini/tmp/<identifier>/chats/. `session/load` will ONLY
// find sessions under the identifier matching the current cwd — showing
// sessions from other projects in the picker leads to JSON-RPC -32603
// "Invalid session identifier" because Gemini searches the wrong dir.
// ---------------------------------------------------------------------------

/**
 * Look up the Gemini project identifier for a given cwd by reading
 * ~/.gemini/projects.json. Returns null if the cwd isn't registered.
 */
function geminiProjectIdentifier(cwd: string): string | null {
  const registryPath = join(homeDir(), ".gemini", "projects.json")
  if (!existsSync(registryPath)) return null
  try {
    const raw = readFileSync(registryPath, "utf-8")
    const registry = JSON.parse(raw) as { projects?: Record<string, string> }
    return registry.projects?.[cwd] ?? null
  } catch {
    return null
  }
}

/**
 * Get the Gemini chats directory for a specific cwd.
 * Returns null when the cwd isn't registered or the chats dir doesn't exist.
 */
function geminiChatDirForCwd(cwd: string): string | null {
  const identifier = geminiProjectIdentifier(cwd)
  if (!identifier) return null
  const chatDir = join(homeDir(), ".gemini", "tmp", identifier, "chats")
  return existsSync(chatDir) ? chatDir : null
}

/** Get all Gemini chat directories (across all projects). */
function geminiChatDirs(): string[] {
  const dirs: string[] = []
  const tmpDir = join(homeDir(), ".gemini", "tmp")
  try {
    const projects = readdirSync(tmpDir, { withFileTypes: true })
    for (const proj of projects) {
      if (proj.isDirectory()) {
        const chatDir = join(tmpDir, proj.name, "chats")
        if (existsSync(chatDir)) {
          dirs.push(chatDir)
        }
      }
    }
  } catch {
    // .gemini/tmp doesn't exist
  }
  return dirs
}

/**
 * Find a Gemini session file by session ID.
 * Gemini session filenames use a truncated UUID prefix (first 8 chars):
 *   session-2026-04-10T06-27-a84cb185.json
 * But the full sessionId inside the JSON is:
 *   a84cb185-f706-415d-b9d2-eada2ba5d0a6
 *
 * We match by checking if the filename contains the UUID prefix,
 * then verify the full sessionId inside the JSON content.
 */
function findGeminiSessionFile(sessionId: string): string | null {
  const shortId = sessionId.split("-")[0] ?? sessionId // First 8 chars of UUID
  for (const chatDir of geminiChatDirs()) {
    try {
      const files = readdirSync(chatDir)
      for (const file of files) {
        if (!file.endsWith(".json")) continue
        // Check if filename contains either the full ID or the short prefix
        if (file.includes(sessionId) || file.includes(shortId)) {
          // Verify by reading the JSON to confirm the full sessionId matches
          try {
            const content = JSON.parse(readFileSync(join(chatDir, file), "utf-8"))
            if (content.sessionId === sessionId) {
              return join(chatDir, file)
            }
          } catch {
            // Parse error — skip this file
          }
        }
      }
    } catch {
      // Not readable
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// detectSessionOrigin — now supports Claude, Codex, and Gemini
// ---------------------------------------------------------------------------

/**
 * Detect which backend originally created a session.
 *
 * Checks session storage on disk for Claude, Codex, and Gemini.
 * Returns null if the session ID doesn't match any known backend's files.
 */
export function detectSessionOrigin(
  sessionId: string,
  cwd: string,
): SessionOrigin {
  // Check if it's a Claude session (JSONL file on disk)
  const claudePath = getSessionFilePath(sessionId, cwd)
  if (existsSync(claudePath)) {
    return "claude"
  }

  // Check if it's a Codex session (rollout-*.jsonl files under ~/.codex/sessions/)
  if (findCodexSessionFile(sessionId)) {
    return "codex"
  }

  // Check if it's a Gemini/ACP session (session-*.json files under ~/.gemini/tmp/)
  if (findGeminiSessionFile(sessionId)) {
    return "gemini"
  }

  return null
}

// ---------------------------------------------------------------------------
// Codex session reader
// ---------------------------------------------------------------------------

/**
 * Parse a Codex JSONL session file into Block[].
 *
 * Codex JSONL format (each line is a JSON object):
 * - {type: "session_meta", payload: {id, timestamp, cwd}} — metadata
 * - {type: "response_item", payload: {role: "user", content: [{type: "input_text", text}]}}
 * - {type: "response_item", payload: {role: "assistant", content: [{type: "output_text", text}]}}
 * - {type: "event_msg", payload: {type: "user_message", message: "..."}} — user prompts
 * - {type: "response_item", payload: {type: "function_call", name, arguments}}
 * - {type: "response_item", payload: {type: "function_call_output", output}}
 */
export function parseCodexSession(filePath: string): Block[] {
  let raw: string
  try {
    raw = readFileSync(filePath, "utf-8")
  } catch (err) {
    log.warn("Failed to read Codex session file", {
      filePath,
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  }

  const blocks: Block[] = []
  const lines = raw.split("\n")

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let entry: any
    try {
      entry = JSON.parse(trimmed)
    } catch {
      continue
    }

    if (entry.type === "session_meta") {
      // Metadata line — skip
      continue
    }

    if (entry.type === "event_msg") {
      const payload = entry.payload
      if (payload?.type === "user_message" && payload.message) {
        blocks.push({ type: "user", text: payload.message })
      } else {
        log.debug("Skipped Codex event_msg", { payloadType: payload?.type })
      }
      continue
    }

    if (entry.type === "response_item") {
      const payload = entry.payload
      if (!payload) continue

      // User message with content array
      if (payload.role === "user" && Array.isArray(payload.content)) {
        let text = ""
        for (const block of payload.content) {
          if (block.type === "input_text" && block.text) {
            text += (text ? "\n" : "") + block.text
          }
        }
        if (text) {
          blocks.push({ type: "user", text })
        }
        continue
      }

      // Assistant message with content array
      if (payload.role === "assistant" && Array.isArray(payload.content)) {
        for (const block of payload.content) {
          if (block.type === "output_text" && block.text) {
            blocks.push({ type: "assistant", text: block.text })
          }
        }
        continue
      }

      // Function call (tool use)
      if (payload.type === "function_call" && payload.name) {
        blocks.push({
          type: "tool",
          id: payload.id ?? payload.call_id ?? `codex-${Date.now()}`,
          tool: payload.name,
          input: payload.arguments ?? "",
          status: "done" as ToolStatus,
          output: "",
          startTime: Date.now(),
        })
        continue
      }

      // Function call output — attach to the preceding tool block
      if (payload.type === "function_call_output" && payload.output != null) {
        // Find the last tool block and update its output
        for (let i = blocks.length - 1; i >= 0; i--) {
          const b = blocks[i]!
          if (b.type === "tool" && !b.output) {
            ;(b as any).output = String(payload.output)
            break
          }
        }
        continue
      }

      log.debug("Skipped Codex response_item", { role: payload.role, type: payload.type })
    }
  }

  log.info("Codex session parsed", {
    filePath,
    blocks: blocks.length,
    users: blocks.filter(b => b.type === "user").length,
    assistants: blocks.filter(b => b.type === "assistant").length,
    tools: blocks.filter(b => b.type === "tool").length,
  })

  return blocks
}

// ---------------------------------------------------------------------------
// Gemini session reader
// ---------------------------------------------------------------------------

/**
 * Parse a Gemini JSON session file into Block[].
 *
 * Gemini JSON format:
 * {
 *   sessionId, startTime, lastUpdated,
 *   messages: [
 *     {type: "user", content: [{text: "..."}] | "string"},
 *     {type: "gemini", content: "...", thoughts: [...], tokens: {...}}
 *   ]
 * }
 */
export function parseGeminiSession(filePath: string): Block[] {
  let raw: string
  try {
    raw = readFileSync(filePath, "utf-8")
  } catch (err) {
    log.warn("Failed to read Gemini session file", {
      filePath,
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  }

  let session: any
  try {
    session = JSON.parse(raw)
  } catch (err) {
    log.warn("Failed to parse Gemini session JSON", {
      filePath,
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  }

  const blocks: Block[] = []
  const messages = session.messages ?? []

  for (const msg of messages) {
    if (msg.type === "user") {
      let text = ""
      if (typeof msg.content === "string") {
        text = msg.content
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.text) {
            text += (text ? "\n" : "") + part.text
          }
        }
      }
      if (text) {
        blocks.push({ type: "user", text })
      }
    } else if (msg.type === "gemini") {
      // Extract thinking/thoughts first
      if (Array.isArray(msg.thoughts)) {
        for (const thought of msg.thoughts) {
          const thoughtText = typeof thought === "string" ? thought : thought?.text
          if (thoughtText) {
            blocks.push({ type: "thinking", text: thoughtText })
          }
        }
      }

      // Extract assistant content
      const content = typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((p: any) => p.text ?? "").filter(Boolean).join("\n")
          : ""
      if (content) {
        blocks.push({ type: "assistant", text: content })
      }
    } else {
      log.debug("Skipped Gemini message type", { type: msg.type })
    }
  }

  log.info("Gemini session parsed", {
    filePath,
    blocks: blocks.length,
    users: blocks.filter(b => b.type === "user").length,
    assistants: blocks.filter(b => b.type === "assistant").length,
    thinking: blocks.filter(b => b.type === "thinking").length,
  })

  return blocks
}

// ---------------------------------------------------------------------------
// readForeignSession — now supports Codex and Gemini
// ---------------------------------------------------------------------------

/**
 * Read a session's conversation history from its original backend.
 *
 * Returns Block[] in the universal conversation format.
 * Returns empty array if the session can't be read.
 */
export function readForeignSession(
  sessionId: string,
  origin: SessionOrigin,
  cwd: string,
): Block[] {
  switch (origin) {
    case "claude":
      return readSessionHistory(sessionId, cwd)

    case "codex": {
      const codexFile = findCodexSessionFile(sessionId)
      if (!codexFile) {
        log.warn("Codex session file not found", { sessionId })
        return []
      }
      return parseCodexSession(codexFile)
    }

    case "gemini": {
      const geminiFile = findGeminiSessionFile(sessionId)
      if (!geminiFile) {
        log.warn("Gemini session file not found", { sessionId })
        return []
      }
      return parseGeminiSession(geminiFile)
    }

    default:
      log.warn("Cannot read session with unknown origin", { sessionId })
      return []
  }
}

// ---------------------------------------------------------------------------
// Disk-based session listing — for use before transport is alive
// ---------------------------------------------------------------------------

/**
 * List Codex sessions from disk (~/.codex/sessions/).
 * Used as a fallback when the Codex transport is not alive.
 */
export function listCodexSessionsFromDisk(): SessionInfo[] {
  const root = codexSessionsDir()
  if (!existsSync(root)) return []

  const files = findJsonlFiles(root)
  const sessions: SessionInfo[] = []

  for (const file of files) {
    try {
      const raw = readFileSync(file, "utf-8")
      const firstLine = raw.split("\n")[0]?.trim()
      if (!firstLine) continue

      const meta = JSON.parse(firstLine)
      if (meta.type !== "session_meta") continue

      const payload = meta.payload ?? {}
      const id = payload.id ?? basename(file, ".jsonl")
      const timestamp = payload.timestamp
        ? new Date(payload.timestamp).getTime()
        : statSync(file).mtimeMs

      // Read the second line for a preview (first user message)
      let title = id.slice(0, 12)
      const secondLine = raw.split("\n")[1]?.trim()
      if (secondLine) {
        try {
          const entry = JSON.parse(secondLine)
          if (entry.type === "event_msg" && entry.payload?.message) {
            title = entry.payload.message.slice(0, 80)
          } else if (entry.type === "response_item" && entry.payload?.role === "user") {
            const content = entry.payload.content
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === "input_text" && block.text) {
                  title = block.text.slice(0, 80)
                  break
                }
              }
            }
          }
        } catch {
          // Can't parse second line — use ID as title
        }
      }

      sessions.push({
        id,
        title,
        createdAt: timestamp,
        updatedAt: statSync(file).mtimeMs,
        cwd: payload.cwd,
      })
    } catch {
      // Skip unreadable files
    }
  }

  // Sort by most recent first
  sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  return sessions
}

/**
 * List Gemini sessions from disk.
 *
 * When a cwd is provided, sessions are scoped to that project's chats dir
 * (~/.gemini/tmp/<identifier>/chats/) so every listed session can actually
 * be resumed via `session/load`. Without a cwd, falls back to scanning all
 * project dirs — only useful for cross-backend detection, not resume.
 */
export function listGeminiSessionsFromDisk(cwd?: string): SessionInfo[] {
  const sessions: SessionInfo[] = []

  const dirs = cwd
    ? (() => {
        const scoped = geminiChatDirForCwd(cwd)
        return scoped ? [scoped] : []
      })()
    : geminiChatDirs()

  for (const chatDir of dirs) {
    try {
      const files = readdirSync(chatDir).filter(f => f.startsWith("session-") && f.endsWith(".json"))
      for (const file of files) {
        const filePath = join(chatDir, file)
        try {
          const raw = readFileSync(filePath, "utf-8")
          const session = JSON.parse(raw)
          const id = session.sessionId ?? basename(file, ".json")
          const startTime = session.startTime ? new Date(session.startTime).getTime() : statSync(filePath).mtimeMs
          const lastUpdated = session.lastUpdated ? new Date(session.lastUpdated).getTime() : startTime

          // Get title from first user message
          let title = id.slice(0, 12)
          const messages = session.messages ?? []
          for (const msg of messages) {
            if (msg.type === "user") {
              const text = typeof msg.content === "string"
                ? msg.content
                : Array.isArray(msg.content)
                  ? msg.content[0]?.text ?? ""
                  : ""
              if (text) {
                title = text.slice(0, 80)
                break
              }
            }
          }

          sessions.push({
            id,
            title,
            createdAt: startTime,
            updatedAt: lastUpdated,
          })
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // Not readable
    }
  }

  sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  return sessions
}

// ---------------------------------------------------------------------------
// formatFullHistory — full-text history for cross-backend context injection
// ---------------------------------------------------------------------------

/**
 * Format Block[] as a full-text prompt for injecting into a foreign backend.
 *
 * Unlike formatHistoryAsContext(), this preserves the FULL text of every
 * message, tool call, and thinking block — no truncation. Groups blocks
 * into conversation turns for readability.
 *
 * Returns { contextText, toolCallCount, turnCount } where:
 * - contextText: the formatted full-history prompt string
 * - toolCallCount: number of tool calls included
 * - turnCount: number of user turns in the history
 */
export function formatFullHistory(
  blocks: Block[],
  origin: string,
): {
  contextText: string
  toolCallCount: number
  turnCount: number
} {
  if (blocks.length === 0) {
    return { contextText: "", toolCallCount: 0, turnCount: 0 }
  }

  const parts: string[] = []
  let toolCallCount = 0
  let turnCount = 0
  let inTurn = false

  for (const block of blocks) {
    switch (block.type) {
      case "user":
        turnCount++
        if (inTurn) {
          // Separate turns with a visual divider
          parts.push("")
        }
        inTurn = true
        parts.push(`=== Turn ${turnCount} ===`)
        parts.push(`User: ${block.text}`)
        break

      case "assistant":
        parts.push(`\nAssistant: ${block.text}`)
        break

      case "thinking":
        parts.push(`\n[Thinking: ${block.text}]`)
        break

      case "tool": {
        toolCallCount++
        const inputStr = formatToolInput(block.tool, block.input)
        parts.push(`\n[Tool: ${block.tool}]`)
        if (inputStr) {
          parts.push(`  Input: ${inputStr}`)
        }
        if (block.output) {
          parts.push(`  Output: ${block.output}`)
        }
        if (block.error) {
          parts.push(`  Error: ${block.error}`)
        }
        break
      }

      case "shell": {
        toolCallCount++
        parts.push(`\n[Shell: ${block.command}]`)
        if (block.output) {
          parts.push(`  Output: ${block.output}`)
        }
        if (block.error) {
          parts.push(`  Error: ${block.error}`)
        }
        break
      }

      case "compact":
        parts.push(`\n[Compacted context: ${block.summary}]`)
        break

      // Skip system, error, plan blocks — they don't carry conversation content
      case "system":
      case "error":
      case "plan":
        break

      default:
        log.debug("Skipped block type in full history formatting", { type: (block as Block).type })
    }
  }

  const header = `[Previous conversation history from ${origin} session \u2014 ${turnCount} turn(s), ${toolCallCount} tool call(s)]`
  const footer = `\n[Resuming session now. Continue the conversation in context of the above history.]`
  const contextText = header + "\n\n" + parts.join("\n") + footer

  return { contextText, toolCallCount, turnCount }
}

// ---------------------------------------------------------------------------
// formatHistoryAsContext (PRESERVED for backward compatibility with tests)
// ---------------------------------------------------------------------------

/**
 * Format Block[] as a text prompt for injecting into a foreign backend.
 *
 * Produces a human-readable conversation transcript that gives the target
 * backend enough context to continue the conversation meaningfully.
 *
 * Returns { contextText, toolCallCount, warningCount } where:
 * - contextText: the formatted prompt string
 * - toolCallCount: number of tool calls found (for the lossy conversion warning)
 * - warningCount: number of blocks that couldn't be fully converted
 */
export function formatHistoryAsContext(blocks: Block[]): {
  contextText: string
  toolCallCount: number
  warningCount: number
} {
  const parts: string[] = []
  let toolCallCount = 0
  let warningCount = 0

  for (const block of blocks) {
    switch (block.type) {
      case "user":
        parts.push(`User: ${block.text}`)
        break

      case "assistant":
        parts.push(`Assistant: ${block.text}`)
        break

      case "thinking":
        // Thinking blocks are internal reasoning — summarize briefly
        parts.push(`[Assistant thinking: ${truncate(block.text, 200)}]`)
        break

      case "tool": {
        toolCallCount++
        const inputSummary = summarizeToolInput(block.tool, block.input)
        const outputSummary = block.output ? truncate(block.output, 300) : "(no output)"
        parts.push(`[Tool: ${block.tool}] ${inputSummary}\n  Output: ${outputSummary}`)
        if (block.error) {
          parts.push(`  Error: ${block.error}`)
        }
        break
      }

      case "system":
        if (!block.ephemeral) {
          parts.push(`[System: ${block.text}]`)
        }
        break

      case "compact":
        parts.push(`[Compacted context: ${block.summary}]`)
        break

      case "shell": {
        toolCallCount++
        parts.push(`[Shell: ${block.command}]\n  Output: ${truncate(block.output, 300)}`)
        if (block.error) {
          parts.push(`  Error: ${block.error}`)
        }
        break
      }

      case "error":
        parts.push(`[Error: ${block.message}]`)
        warningCount++
        break

      case "plan":
        parts.push(`[Plan: ${block.entries.map(e => `${e.status ?? "pending"}: ${e.content}`).join("; ")}]`)
        break

      default:
        warningCount++
        log.debug("Skipped unknown block type in history formatting", { type: (block as Block).type })
    }
  }

  const contextText = parts.join("\n\n")
  return { contextText, toolCallCount, warningCount }
}

/**
 * Check whether a resume operation is cross-backend.
 *
 * Returns true when the session's origin differs from the target backend.
 * Returns false for same-backend resume or when origin can't be detected.
 */
export function isCrossBackendResume(
  sessionId: string,
  targetBackend: string,
  cwd: string,
): boolean {
  const origin = detectSessionOrigin(sessionId, cwd)
  if (!origin) return false
  return origin !== targetBackend
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Truncate text to maxLen characters, appending ellipsis if truncated */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + "..."
}

/** Format full tool input for the history transcript (no truncation) */
function formatToolInput(tool: string, input: unknown): string {
  if (!input || typeof input !== "object") {
    if (typeof input === "string") return input
    return ""
  }

  const obj = input as Record<string, unknown>

  switch (tool) {
    case "Read":
    case "ReadFile":
      return obj.file_path ? String(obj.file_path) : ""

    case "Edit":
    case "EditFile":
      if (obj.file_path) {
        let result = String(obj.file_path)
        if (obj.old_string) result += `\n    old: ${String(obj.old_string)}`
        if (obj.new_string) result += `\n    new: ${String(obj.new_string)}`
        return result
      }
      return ""

    case "Write":
    case "WriteFile":
      return obj.file_path ? String(obj.file_path) : ""

    case "Bash":
    case "bash":
      return obj.command ? `$ ${String(obj.command)}` : ""

    case "Grep":
    case "Search":
      return obj.pattern ? `pattern="${obj.pattern}"` : ""

    case "Glob":
      return obj.pattern ? `pattern="${obj.pattern}"` : ""

    default:
      // Full JSON for unknown tools
      try {
        return JSON.stringify(input)
      } catch {
        return ""
      }
  }
}

/** Summarize tool input for the history transcript */
function summarizeToolInput(tool: string, input: unknown): string {
  if (!input || typeof input !== "object") return ""

  const obj = input as Record<string, unknown>

  // Common tool patterns
  switch (tool) {
    case "Read":
    case "ReadFile":
      return obj.file_path ? `Read ${obj.file_path}` : ""

    case "Edit":
    case "EditFile":
      return obj.file_path ? `Edit ${obj.file_path}` : ""

    case "Write":
    case "WriteFile":
      return obj.file_path ? `Write ${obj.file_path}` : ""

    case "Bash":
    case "bash":
      return obj.command ? `$ ${truncate(String(obj.command), 200)}` : ""

    case "Grep":
    case "Search":
      return obj.pattern ? `Search for "${obj.pattern}"` : ""

    case "Glob":
      return obj.pattern ? `Glob "${obj.pattern}"` : ""

    case "ListDir":
      return obj.path ? `List ${obj.path}` : ""

    default: {
      // Generic: show first few key-value pairs
      const entries = Object.entries(obj).slice(0, 3)
      if (entries.length === 0) return ""
      return entries
        .map(([k, v]) => `${k}: ${truncate(String(v), 80)}`)
        .join(", ")
    }
  }
}
