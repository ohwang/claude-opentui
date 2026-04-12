/**
 * Session JSONL Reader
 *
 * Reads a Claude Code session JSONL file and converts it to Block[]
 * for pre-populating the conversation view on resume/continue.
 *
 * The SDK's query() API doesn't replay historical messages — it loads
 * context internally. We read the JSONL directly to render history.
 *
 * JSONL entry types:
 * - `user` — User message (message.content: ContentBlock[])
 * - `assistant` — Assistant response (message.content: ContentBlock[])
 * - `queue-operation` — Internal queue bookkeeping (skip)
 * - `last-prompt` — Last prompt cache (skip)
 * - `permission-mode` — Permission mode change (skip)
 * - `file-history-snapshot` — File version tracking (skip)
 * - `system` — System events, compaction (skip for now)
 */

import { readFileSync } from "fs"
import { join } from "path"
import { log } from "../../utils/logger"
import type {
  Block,
  ParsedSession,
  SessionResumeSummary,
  SessionResumeUsage,
  ToolStatus,
} from "../../protocol/types"

/** Encode a cwd path to the Claude project directory key format */
function encodeProjectKey(cwd: string): string {
  return cwd.replace(/\//g, "-")
}

/** Get the session JSONL file path */
export function getSessionFilePath(sessionId: string, cwd: string): string {
  const projectKey = encodeProjectKey(cwd)
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? "~"
  return join(homeDir, ".claude", "projects", projectKey, `${sessionId}.jsonl`)
}

/** Strip SDK image placeholders that native Claude Code doesn't display */
function stripImagePlaceholders(text: string): string {
  return text
    .replace(/\[Image(?:\s*#?\s*\d+)?\]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** Read a session JSONL file and convert to blocks + summary for conversation display.
 *
 *  Note on images: Claude JSONL stores pasted screenshots as base64-encoded
 *  `image` content blocks. We intentionally do NOT replay those back to the
 *  conversation history on resume — base64 payloads are often megabytes per
 *  image, OpenTUI doesn't yet expose a terminal image primitive, and
 *  rendering them would slow down every scroll/repaint. Image blocks are
 *  dropped here and, where the SDK left a `[Image]` placeholder inside a
 *  text block, `stripImagePlaceholders` removes that too so the user sees a
 *  clean text-only transcript. See the "Image round-tripping" follow-up in
 *  plans/quirky-dreaming-book.md for the tracked reasoning.
 */
export function readSessionHistory(
  sessionId: string,
  cwd: string,
): ParsedSession {
  const filePath = getSessionFilePath(sessionId, cwd)
  log.info("Reading session history", { sessionId, filePath })

  const emptySummary: SessionResumeSummary = {
    sessionId,
    origin: "claude",
    target: "claude",
    messageCount: 0,
    toolCallCount: 0,
    turnCount: 0,
    filePath,
  }

  let raw: string
  try {
    raw = readFileSync(filePath, "utf-8")
  } catch (err) {
    log.warn("Failed to read session file", {
      sessionId,
      filePath,
      error: err instanceof Error ? err.message : String(err),
    })
    return { blocks: [], summary: emptySummary }
  }

  const blocks: Block[] = []
  const lines = raw.split("\n")

  // Usage aggregation. Claude's per-message `usage` contains fields that are
  // DISJOINT (input + cache_read + cache_creation = total prompt tokens for
  // that API call), so we sum across messages for cumulative totals and use
  // the last assistant turn's values for "effective context currently in play".
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheCreationTokens = 0
  let totalCostUsd = 0
  let lastContextTokens: number | undefined
  let lastActiveAt: number | undefined
  let messageCount = 0
  let toolCallCount = 0
  let turnCount = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let entry: any
    try {
      entry = JSON.parse(trimmed)
    } catch {
      continue
    }

    const entryTs = entry.timestamp ? new Date(entry.timestamp).getTime() : undefined
    if (entryTs !== undefined) {
      lastActiveAt = lastActiveAt === undefined ? entryTs : Math.max(lastActiveAt, entryTs)
    }

    switch (entry.type) {
      case "user": {
        const content = entry.message?.content
        if (!Array.isArray(content)) break

        let text = ""
        for (const block of content) {
          if (block.type === "text") {
            text += (text ? "\n" : "") + block.text
          }
          // Skip tool_result blocks — internal to the agent loop.
          // Skip image blocks — see "Note on images" above.
        }

        // Skip tool_result user messages (no text content, only tool results)
        if (!text) break

        // Also skip if all content blocks are tool_result type
        const hasOnlyToolResults = content.every(
          (b: any) => b.type === "tool_result",
        )
        if (hasOnlyToolResults) break

        blocks.push({ type: "user", text })
        messageCount++
        turnCount++
        break
      }

      case "assistant": {
        const content = entry.message?.content
        if (!Array.isArray(content)) break
        const usage = entry.message?.usage
        if (usage && typeof usage === "object") {
          const input = Number(usage.input_tokens ?? 0)
          const output = Number(usage.output_tokens ?? 0)
          const cacheRead = Number(usage.cache_read_input_tokens ?? 0)
          const cacheCreate = Number(usage.cache_creation_input_tokens ?? 0)
          inputTokens += input
          outputTokens += output
          cacheReadTokens += cacheRead
          cacheCreationTokens += cacheCreate
          // Per-turn context = full prompt tokens for this API call.
          // Use the LAST assistant turn's value so the summary reflects
          // "how much context the next turn will carry".
          lastContextTokens = input + cacheRead + cacheCreate
        }
        if (typeof entry.costUSD === "number") {
          totalCostUsd += entry.costUSD
        }

        let hasAssistantBlock = false
        for (const block of content) {
          switch (block.type) {
            case "thinking":
              if (block.thinking) {
                blocks.push({ type: "thinking", text: block.thinking })
              }
              break

            case "text":
              if (block.text) {
                hasAssistantBlock = true
                blocks.push({
                  type: "assistant",
                  text: stripImagePlaceholders(block.text),
                  timestamp: entry.timestamp
                    ? new Date(entry.timestamp).getTime()
                    : undefined,
                })
              }
              break

            case "tool_use":
              toolCallCount++
              blocks.push({
                type: "tool",
                id: block.id,
                tool: block.name,
                input: block.input ?? {},
                status: "done" as ToolStatus,
                output: "",
                startTime: entry.timestamp
                  ? new Date(entry.timestamp).getTime()
                  : Date.now(),
              })
              break
          }
        }
        if (hasAssistantBlock) messageCount++
        break
      }

      // Skip all other entry types (queue-operation, last-prompt, etc.)
    }
  }

  const usage: SessionResumeUsage | undefined =
    inputTokens || outputTokens || cacheReadTokens || cacheCreationTokens || totalCostUsd
      ? {
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheCreationTokens,
          totalCostUsd,
          contextTokens: lastContextTokens ?? (inputTokens + cacheReadTokens + cacheCreationTokens),
        }
      : undefined

  const summary: SessionResumeSummary = {
    sessionId,
    origin: "claude",
    target: "claude",
    messageCount,
    toolCallCount,
    turnCount,
    lastActiveAt,
    usage,
    filePath,
  }

  log.info("Session history loaded", {
    sessionId,
    blocks: blocks.length,
    users: blocks.filter((b) => b.type === "user").length,
    assistants: blocks.filter((b) => b.type === "assistant").length,
    tools: blocks.filter((b) => b.type === "tool").length,
    usage,
  })

  return { blocks, summary }
}

/** Find the most recently modified session in a project directory */
export function findMostRecentSession(cwd: string): string | null {
  const projectKey = encodeProjectKey(cwd)
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? "~"
  const projectDir = join(homeDir, ".claude", "projects", projectKey)

  try {
    const { readdirSync, statSync } = require("fs")
    const files = readdirSync(projectDir) as string[]
    const jsonlFiles = files
      .filter((f: string) => f.endsWith(".jsonl"))
      .map((f: string) => ({
        name: f,
        mtime: statSync(join(projectDir, f)).mtimeMs,
      }))
      .sort((a: any, b: any) => b.mtime - a.mtime)

    const mostRecent = jsonlFiles[0]
    if (!mostRecent) return null
    return mostRecent.name.replace(".jsonl", "")
  } catch {
    return null
  }
}
