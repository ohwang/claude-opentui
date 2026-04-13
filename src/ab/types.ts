/**
 * A/B Comparison — shared types.
 *
 * The orchestrator moves through a fixed sequence of phases. Each phase
 * either:
 *   - owns a running session (executing, judging, combining)
 *   - waits on user input (review, comparing, adopt-error)
 *   - drives an irreversible side effect (adopting)
 *
 * A `Target` is the dual of a backend identity: backend registry id +
 * optional model. Either side of the A/B can pick any target from the
 * registry, so cross-backend comparisons are first-class.
 */

import type { BackendId } from "../protocol/registry"
import type { ModelChangedEvent } from "../protocol/types"
import type { DiffStats, Worktree } from "../utils/git-worktree"

/** Backend + (optional) model pairing for one side of the comparison. */
export interface Target {
  backendId: BackendId
  model?: string
}

/** Human-readable label for a side — always "A" or "B". */
export type Label = "A" | "B"

/** IDs of built-in judge criteria templates. */
export type JudgeCriteriaId = "quality" | "angles" | "stability"

/** Phases that the A/B overlay transitions through. */
export type Phase =
  | "review"
  | "executing"
  | "comparing"
  | "judge-setup"
  | "judging"
  | "combining"
  | "adopting"
  | "adopt-error"
  | "done"

/** Live stats derived from a running session's event stream. */
export interface SessionStats {
  label: Label
  backendId: string
  model?: string
  /** Rolling text transcript (plain text view of assistant output). */
  output: string
  /** Turns completed (seen turn_complete events). */
  turns: number
  /** Running token totals (from cost_update events). */
  inputTokens: number
  outputTokens: number
  totalCostUsd: number
  /** Tool-use invocations started. */
  toolUseCount: number
  /** Session started at (epoch ms). */
  startTime: number
  /** Session ended at (epoch ms) — undefined until completion. */
  endTime?: number
  /** Unique file paths the session wrote/edited (best-effort, from tool inputs). */
  filesTouched: string[]
  /** Most recent error message, if any. */
  error?: string
  /** True once the session terminates (turn_complete w/ no follow-up within a grace window, or stream end). */
  complete: boolean
  /** True if the user interrupted this side. */
  interrupted: boolean
}

/** Result of the judge phase. */
export interface JudgeResult {
  /** "A" | "B" | "tie" | null (undecided). */
  recommendation: Label | "tie" | null
  /** Full judge transcript. */
  reasoning: string
  /** Criteria template that was used. */
  criteriaName: string
  /** Whether the judge completed cleanly. */
  complete: boolean
  /** Error, if any. */
  error?: string
}

/** Result of the combine phase. */
export interface CombineResult {
  complete: boolean
  reasoning: string
  error?: string
  /** Files the combine session touched in the main project dir. */
  filesTouched: string[]
}

export interface WorktreeBundle {
  pair: { a: Worktree; b: Worktree }
  /** True when we stashed WIP on the main branch before creating worktrees. */
  hadStash: boolean
  /** Whether the stash has been popped back to main yet. */
  stashPopped: boolean
  /** HEAD SHA at fork time (baseline for diffs). */
  baselineSha: string
  /** When dirty state was seeded into worktrees, this is the seed commit SHA
   *  used as the diff baseline so only session-authored changes show up. */
  seedSha?: string
}

/** Aggregate snapshot of the comparison state after both sides complete. */
export interface ComparisonSnapshot {
  promptA: string
  promptB: string
  targetA: Target
  targetB: Target
  statsA: SessionStats
  statsB: SessionStats
  diffA: DiffStats
  diffB: DiffStats
  worktreeA: Worktree
  worktreeB: Worktree
  judge: JudgeResult | null
  combine: CombineResult | null
}

/** Pure function re-export so callers don't need to pull model_changed themselves. */
export type { ModelChangedEvent }
