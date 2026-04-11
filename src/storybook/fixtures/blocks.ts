/**
 * Block factory functions for storybook stories.
 */

import type { Block, ToolStatus } from "../../protocol/types"

let _id = 0
function uid(): string {
  return `sb_${++_id}_${Math.random().toString(36).slice(2, 6)}`
}

export function userBlock(text: string, opts?: { images?: { data: string; mediaType: "image/png" }[] }): Extract<Block, { type: "user" }> {
  return { type: "user", text, ...opts }
}

export function assistantBlock(text: string, opts?: { model?: string }): Extract<Block, { type: "assistant" }> {
  return { type: "assistant", text, timestamp: Date.now(), model: opts?.model }
}

export function thinkingBlock(text: string): Extract<Block, { type: "thinking" }> {
  return { type: "thinking", text }
}

export function toolBlock(
  tool: string,
  input: unknown,
  opts?: { status?: ToolStatus; output?: string; error?: string; duration?: number },
): Extract<Block, { type: "tool" }> {
  const duration = opts?.duration ?? 1200
  return {
    type: "tool",
    id: uid(),
    tool,
    input,
    status: opts?.status ?? "done",
    output: opts?.output,
    error: opts?.error,
    startTime: Date.now() - duration,
    duration,
  }
}

export function systemBlock(text: string, opts?: { ephemeral?: boolean }): Extract<Block, { type: "system" }> {
  return { type: "system", text, ephemeral: opts?.ephemeral }
}

export function errorBlock(code: string, message: string): Extract<Block, { type: "error" }> {
  return { type: "error", code, message }
}

export function shellBlock(
  command: string,
  opts?: { output?: string; error?: string; exitCode?: number; status?: "running" | "done" | "error"; duration?: number },
): Extract<Block, { type: "shell" }> {
  const duration = opts?.duration ?? 500
  return {
    type: "shell",
    id: uid(),
    command,
    output: opts?.output ?? "",
    error: opts?.error,
    exitCode: opts?.exitCode ?? 0,
    status: opts?.status ?? "done",
    startTime: Date.now() - duration,
    duration,
  }
}

export function compactBlock(
  summary: string,
  opts?: { trigger?: "user" | "auto"; preTokens?: number; postTokens?: number; inProgress?: boolean },
): Extract<Block, { type: "compact" }> {
  return {
    type: "compact",
    summary,
    trigger: opts?.trigger,
    preTokens: opts?.preTokens,
    postTokens: opts?.postTokens,
    inProgress: opts?.inProgress,
  }
}
