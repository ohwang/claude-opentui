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
import type { Block, ToolStatus } from "../../protocol/types"

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

/** Read a session JSONL file and convert to blocks for conversation display */
export function readSessionHistory(
  sessionId: string,
  cwd: string,
): Block[] {
  const filePath = getSessionFilePath(sessionId, cwd)
  log.info("Reading session history", { sessionId, filePath })

  let raw: string
  try {
    raw = readFileSync(filePath, "utf-8")
  } catch (err) {
    log.warn("Failed to read session file", {
      sessionId,
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

    switch (entry.type) {
      case "user": {
        const content = entry.message?.content
        if (!Array.isArray(content)) break

        let text = ""
        for (const block of content) {
          if (block.type === "text") {
            text += (text ? "\n" : "") + block.text
          }
          // Skip tool_result blocks — they're internal to the agent loop
          // Skip image blocks for now
        }

        // Skip tool_result user messages (no text content, only tool results)
        if (!text) break

        // Also skip if all content blocks are tool_result type
        const hasOnlyToolResults = content.every(
          (b: any) => b.type === "tool_result",
        )
        if (hasOnlyToolResults) break

        blocks.push({ type: "user", text })
        break
      }

      case "assistant": {
        const content = entry.message?.content
        if (!Array.isArray(content)) break

        for (const block of content) {
          switch (block.type) {
            case "thinking":
              if (block.thinking) {
                blocks.push({ type: "thinking", text: block.thinking })
              }
              break

            case "text":
              if (block.text) {
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
        break
      }

      // Skip all other entry types (queue-operation, last-prompt, etc.)
    }
  }

  log.info("Session history loaded", {
    sessionId,
    blocks: blocks.length,
    users: blocks.filter((b) => b.type === "user").length,
    assistants: blocks.filter((b) => b.type === "assistant").length,
    tools: blocks.filter((b) => b.type === "tool").length,
  })

  return blocks
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

    if (jsonlFiles.length === 0) return null
    return jsonlFiles[0].name.replace(".jsonl", "")
  } catch {
    return null
  }
}
