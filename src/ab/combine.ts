/**
 * A/B Combine — prompt builder for the merge-the-best-of-both session.
 *
 * Unlike the judge, the combine session writes directly to the main project
 * directory — no worktree — because its whole purpose is to synthesize a
 * merged result in the user's checkout. Worktrees A and B stay read-only
 * and are cleaned up after the combine session finishes.
 *
 * Prompt is adapted from claude-exmode/src/agent/combine-session.ts with
 * adjustments so bantai's cross-backend labeling still works (we say
 * "Approach A (claude sonnet-4-6)" rather than claude-specific copy).
 */

import type { DiffStats } from "../utils/git-worktree"
import type { SessionStats, Target } from "./types"

export interface CombinePromptConfig {
  prompt: string
  targetA: Target
  targetB: Target
  statsA: SessionStats
  statsB: SessionStats
  diffA: DiffStats
  diffB: DiffStats
  worktreePathA: string
  worktreePathB: string
  /** Main project directory — the combine session writes here. */
  projectDir: string
}

function labelTarget(t: Target): string {
  return t.model ? `${t.backendId} (${t.model})` : t.backendId
}

function formatStatsBlock(stats: SessionStats, diff: DiffStats): string {
  const dur = stats.endTime && stats.startTime
    ? Math.round((stats.endTime - stats.startTime) / 1000)
    : null
  const lines = [
    `- Turns: ${stats.turns}`,
    `- Tool invocations: ${stats.toolUseCount}`,
    dur != null ? `- Duration: ${dur}s` : null,
    `- Cost: $${stats.totalCostUsd.toFixed(4)}`,
    `- Files changed: ${diff.filesChanged} (+${diff.insertions}/-${diff.deletions})`,
  ].filter(Boolean)
  return lines.join("\n")
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s || "(no output captured)"
  return `${s.slice(0, max)}\n...[truncated, ${s.length - max} more chars]`
}

export function buildCombinePrompt(cfg: CombinePromptConfig): string {
  const parts: string[] = []

  parts.push(
    `You are combining the results of two parallel AI coding sessions that tackled the same prompt with different approaches. Both approaches produced useful work, and the user wants the best parts of both incorporated into the main project.

Your job:
1. Read the changed files in both worktrees to understand what each approach did
2. Identify the strengths and complementary aspects of each approach
3. Apply the combined result to the MAIN project directory (${cfg.projectDir})
4. Resolve conflicts or overlaps between the two approaches intelligently

IMPORTANT: Write your changes to ${cfg.projectDir}, NOT to either worktree. The worktrees are READ-ONLY references.`,
  )

  parts.push(`## The Prompt

${cfg.prompt}`)

  parts.push(`## Execution Summary

**Approach A** — ${labelTarget(cfg.targetA)}
${formatStatsBlock(cfg.statsA, cfg.diffA)}

**Approach B** — ${labelTarget(cfg.targetB)}
${formatStatsBlock(cfg.statsB, cfg.diffB)}`)

  parts.push(`## Worktree Locations (read-only)

- **A:** ${cfg.worktreePathA}
- **B:** ${cfg.worktreePathB}`)

  if (cfg.diffA.changedFiles.length > 0) {
    parts.push(`### A changed files (read from ${cfg.worktreePathA}):
${cfg.diffA.changedFiles.map((f) => `- ${f}`).join("\n")}`)
  }
  if (cfg.diffB.changedFiles.length > 0) {
    parts.push(`### B changed files (read from ${cfg.worktreePathB}):
${cfg.diffB.changedFiles.map((f) => `- ${f}`).join("\n")}`)
  }

  parts.push(`## Session Outputs (truncated)

**A:**
${truncate(cfg.statsA.output, 3000)}

**B:**
${truncate(cfg.statsB.output, 3000)}`)

  parts.push(`## Instructions

1. Read all changed files in both worktrees
2. For files touched by only one approach: apply those changes to the main project
3. For files touched by both: merge intelligently, keeping the best of each
4. For new files: copy them into the main project
5. After applying changes, briefly summarize what you combined and any decisions you made

Write all changes to ${cfg.projectDir}. Be thorough — the user expects a complete combined result.`)

  return parts.join("\n\n")
}
