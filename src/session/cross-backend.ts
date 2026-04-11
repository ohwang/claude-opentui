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
 *   3. formatHistoryAsContext() — convert Block[] to a text prompt for injection
 *
 * Only Claude sessions are currently readable (JSONL files on disk).
 * Codex/ACP sessions are server-managed and not accessible for cross-backend reads.
 */

import { existsSync } from "node:fs"
import { log } from "../utils/logger"
import {
  getSessionFilePath,
  readSessionHistory,
} from "../backends/claude/session-reader"
import type { Block } from "../protocol/types"

/** Known backend names that can originate sessions */
export type SessionOrigin = "claude" | "codex" | "acp" | null

/**
 * Detect which backend originally created a session.
 *
 * Currently only Claude sessions are detectable (JSONL files on disk).
 * Codex/ACP sessions are server-managed — if the session ID doesn't match
 * a Claude file, we return null (unknown origin).
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

  // Future: Codex and ACP session detection could be added here
  // if their session storage becomes accessible.

  return null
}

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

    case "codex":
      log.warn("Cross-backend read for Codex sessions not yet supported — Codex sessions are server-managed")
      return []

    case "acp":
      log.warn("Cross-backend read for ACP sessions not yet supported — ACP sessions are server-managed")
      return []

    default:
      log.warn("Cannot read session with unknown origin", { sessionId })
      return []
  }
}

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
