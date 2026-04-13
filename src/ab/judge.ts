/**
 * A/B Judge — criteria templates + prompt builder + recommendation parsing.
 *
 * Ported from claude-exmode/src/judge-criteria.ts with one adaptation:
 * bantai's `Target` includes the backend id, so the prompt mentions which
 * backend produced each approach (useful when A is Claude and B is Codex).
 */

import type { DiffStats } from "../utils/git-worktree"
import type { JudgeCriteriaId, SessionStats, Target } from "./types"

export interface JudgeCriteria {
  id: JudgeCriteriaId
  name: string
  description: string
  prompt: string
}

export const JUDGE_TEMPLATES: JudgeCriteria[] = [
  {
    id: "quality",
    name: "Quality Showdown",
    description: "Best overall code quality wins",
    prompt: `## Your Task

1. Read the changed files in both worktrees to understand what each approach actually did
2. Evaluate code quality, correctness, completeness, and maintainability
3. Consider the trade-offs: diff size, complexity, test coverage, edge cases
4. Provide a clear recommendation: **"RECOMMENDATION: A"** or **"RECOMMENDATION: B"** (on its own line)
5. Explain your reasoning concisely

Be direct and decisive. The user is waiting to pick a winner.`,
  },
  {
    id: "angles",
    name: "Explore Angles",
    description: "Critique different approaches on their own merits",
    prompt: `## Your Task

These two approaches may take fundamentally different angles on the problem. Do NOT simply pick the "better" one — understand what each approach uniquely brings to the table.

1. Read the changed files in both worktrees carefully
2. For each approach, identify its strategy: what angle does it take? What trade-offs does it make? What does it unlock that the other doesn't?
3. Assess where each approach shines and where it falls short
4. Consider which approach is more creative, insightful, or opens up better future possibilities
5. Provide a clear recommendation: **"RECOMMENDATION: A"** or **"RECOMMENDATION: B"** (on its own line)
6. Explain what each approach does well and why you favor your recommendation

Value originality and strategic thinking, not just conventional code quality metrics.`,
  },
  {
    id: "stability",
    name: "Stability First",
    description: "Prioritize reliability and robustness over features",
    prompt: `## Your Task

Evaluate both approaches with a strong bias toward reliability and robustness. Feature count matters less than confidence that the code works correctly under real-world conditions.

1. Read the changed files in both worktrees
2. Check error handling: does the code handle edge cases, invalid inputs, and failure modes gracefully?
3. Look for defensive coding: null checks, boundary conditions, type safety, resource cleanup
4. Assess test coverage: which approach has better tests, or is more testable?
5. Consider simplicity: simpler code is more reliable — penalize unnecessary complexity and cleverness
6. Provide a clear recommendation: **"RECOMMENDATION: A"** or **"RECOMMENDATION: B"** (on its own line)
7. Explain your reasoning, emphasizing reliability concerns

When in doubt, prefer the approach that is less likely to break in production.`,
  },
]

/** Default criteria when the user doesn't pick one. */
export function getDefaultCriteria(): JudgeCriteria {
  return JUDGE_TEMPLATES[0]!
}

/** Look up a criteria template by id. Returns undefined for unknown ids. */
export function findCriteria(id: string): JudgeCriteria | undefined {
  return JUDGE_TEMPLATES.find((t) => t.id === id)
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

export interface JudgePromptConfig {
  prompt: string
  targetA: Target
  targetB: Target
  statsA: SessionStats
  statsB: SessionStats
  diffA: DiffStats
  diffB: DiffStats
  worktreePathA: string
  worktreePathB: string
  criteria: JudgeCriteria
}

/** Compose a judge prompt for the chosen criteria. */
export function buildJudgePrompt(cfg: JudgePromptConfig): string {
  const parts: string[] = []

  parts.push(
    `You are acting as a judge in an A/B comparison. Two AI coding sessions were given the same prompt and worked in parallel git worktrees. Your job is to review both and recommend which one should be adopted.`,
  )

  parts.push(`## The Prompt

${cfg.prompt}`)

  parts.push(`## Execution Summary

**Approach A** — ${labelTarget(cfg.targetA)}
${formatStatsBlock(cfg.statsA, cfg.diffA)}

**Approach B** — ${labelTarget(cfg.targetB)}
${formatStatsBlock(cfg.statsB, cfg.diffB)}`)

  parts.push(`## Worktree Locations

- **A:** ${cfg.worktreePathA}
- **B:** ${cfg.worktreePathB}

Read the actual changed files (paths below) to inform your decision.`)

  if (cfg.diffA.changedFiles.length > 0) {
    parts.push(`### A changed files (in ${cfg.worktreePathA})
${cfg.diffA.changedFiles.map((f) => `- ${f}`).join("\n")}`)
  }
  if (cfg.diffB.changedFiles.length > 0) {
    parts.push(`### B changed files (in ${cfg.worktreePathB})
${cfg.diffB.changedFiles.map((f) => `- ${f}`).join("\n")}`)
  }

  parts.push(`## Session Outputs (truncated)

**A:**
${truncate(cfg.statsA.output, 3000)}

**B:**
${truncate(cfg.statsB.output, 3000)}`)

  parts.push(cfg.criteria.prompt)

  return parts.join("\n\n")
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

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

/**
 * Parse a judge response to extract the recommendation. Accepts:
 *   - "RECOMMENDATION: A" / "RECOMMENDATION: B" / "RECOMMENDATION: TIE"
 *   - Anywhere in the transcript, case-insensitive
 * Returns null when nothing matches — the caller can treat that as "undecided".
 */
export function parseRecommendation(text: string): "A" | "B" | "tie" | null {
  const match = text.match(/RECOMMENDATION:\s*(A|B|TIE)\b/i)
  if (!match) return null
  const raw = match[1]!.toUpperCase()
  if (raw === "A") return "A"
  if (raw === "B") return "B"
  return "tie"
}
