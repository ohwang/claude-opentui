/**
 * A/B Orchestrator — phase state machine + worktree + session lifecycle.
 *
 * Responsibilities:
 *   1. Manage the phase machine: review → executing → comparing → (judging |
 *      combining)? → adopting → done.
 *   2. Own the worktree pair and stash lifecycle (fork-safe — user's WIP is
 *      preserved across the whole run).
 *   3. Spawn/manage the two A/B session runners and the optional judge /
 *      combine runners.
 *   4. Collect diff stats after both sessions finish.
 *   5. Merge the winner back into main using the three-tier strategy.
 *
 * Kept UI-agnostic: exposes SolidJS signals (phase, stats, etc) so the
 * TUI subscribes, but never imports OpenTUI components. This also makes
 * the orchestrator trivially testable.
 *
 * Ported from claude-exmode/src/hooks/use-orchestrator.ts with:
 *   - SolidJS signals instead of React state
 *   - Cross-backend targets (any backend from the registry, not just Claude)
 *   - No marker files / PID walking (single-process TUI)
 */

import { createRoot, createSignal, type Accessor } from "solid-js"
import type { DiffStats, WorktreePair } from "../utils/git-worktree"
import {
  cleanupWorktrees,
  collectDiff,
  commitWorktreeChanges,
  createWorktrees,
  getHead,
  mergeWinner,
  seedWorktreeFromStash,
  softResetTo,
  stashDirtyState,
  stashPop,
} from "../utils/git-worktree"
import { log } from "../utils/logger"
import {
  buildCombinePrompt,
  type CombinePromptConfig,
} from "./combine"
import {
  buildJudgePrompt,
  findCriteria,
  getDefaultCriteria,
  type JudgeCriteria,
  parseRecommendation,
} from "./judge"
import { runSession, type SessionHandle } from "./session-runner"
import type {
  CombineResult,
  ComparisonSnapshot,
  JudgeResult,
  Label,
  Phase,
  SessionStats,
  Target,
  WorktreeBundle,
} from "./types"

export interface AdoptionError {
  message: string
  winner: Label
  worktreePathA: string
  worktreePathB: string
}

export interface OrchestratorOptions {
  projectDir: string
  /** Used as a session-id prefix for worktree branch naming. */
  sessionId: string
  prompt: string
  targetA: Target
  targetB: Target
  /** Optional criteria id — defaults to "quality". */
  criteriaId?: string
  /** Called once the orchestrator terminates (done or aborted). */
  onDone?: (result: OrchestratorResult) => void
}

export interface OrchestratorResult {
  /** Phase the orchestrator exited in — "done" on success, other values on abort. */
  phase: Phase
  /** Final snapshot of comparison state when available. */
  snapshot?: ComparisonSnapshot
  /** Merge outcome if a winner was adopted. */
  mergeMethod?: "fast-forward" | "merge" | "none"
  /** Winner adopted, or null when the run exited via combine / cancel. */
  winner?: Label | "combine" | null
  /** Error message if the run aborted with a failure. */
  error?: string
}

export interface OrchestratorHandle {
  // --- Reactive state ---
  phase: Accessor<Phase>
  statsA: Accessor<SessionStats>
  statsB: Accessor<SessionStats>
  diffA: Accessor<DiffStats | null>
  diffB: Accessor<DiffStats | null>
  judge: Accessor<JudgeResult | null>
  combineResult: Accessor<CombineResult | null>
  adoptionStatus: Accessor<string>
  adoptionError: Accessor<AdoptionError | null>
  criteria: Accessor<JudgeCriteria>

  // --- Metadata ---
  readonly prompt: string
  readonly targetA: Target
  readonly targetB: Target

  // --- User actions ---
  start: () => Promise<void>
  interruptBoth: () => void
  interruptJudge: () => void
  interruptCombine: () => void
  adopt: (winner: Label) => Promise<void>
  startJudge: (criteriaId?: string) => Promise<void>
  startCombine: () => Promise<void>
  cancel: () => void
  retryAdopt: () => Promise<void>
  /** After adopt-error, exit preserving worktrees for manual recovery. */
  preserveWorktreesAndExit: () => void
}

export function createOrchestrator(
  opts: OrchestratorOptions,
): OrchestratorHandle {
  return createRoot((dispose) => {
    const [phase, setPhase] = createSignal<Phase>("review")
    const [criteria, setCriteria] = createSignal<JudgeCriteria>(
      findCriteria(opts.criteriaId ?? "quality") ?? getDefaultCriteria(),
    )

    const emptyStats = (label: Label, target: Target): SessionStats => ({
      label,
      backendId: target.backendId,
      model: target.model,
      output: "",
      turns: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalCostUsd: 0,
      toolUseCount: 0,
      startTime: 0,
      filesTouched: [],
      complete: false,
      interrupted: false,
    })

    const [statsA, setStatsA] = createSignal<SessionStats>(emptyStats("A", opts.targetA))
    const [statsB, setStatsB] = createSignal<SessionStats>(emptyStats("B", opts.targetB))
    const [diffA, setDiffA] = createSignal<DiffStats | null>(null)
    const [diffB, setDiffB] = createSignal<DiffStats | null>(null)
    const [judge, setJudge] = createSignal<JudgeResult | null>(null)
    const [combineResult, setCombineResult] = createSignal<CombineResult | null>(null)
    const [adoptionStatus, setAdoptionStatus] = createSignal("")
    const [adoptionError, setAdoptionError] = createSignal<AdoptionError | null>(null)

    // --- Non-reactive state owned by the orchestrator ---
    let bundle: WorktreeBundle | null = null
    let handleA: SessionHandle | null = null
    let handleB: SessionHandle | null = null
    let judgeHandle: SessionHandle | null = null
    let combineHandle: SessionHandle | null = null
    let settled = false

    const fail = (reason: string, phaseAfter: Phase = "done") => {
      log.error("A/B orchestrator failed", { reason })
      setPhase(phaseAfter)
      cleanup()
      settleDone({ phase: phaseAfter, error: reason })
    }

    const cleanup = () => {
      try {
        if (handleA) handleA.close()
      } catch {}
      try {
        if (handleB) handleB.close()
      } catch {}
      try {
        if (judgeHandle) judgeHandle.close()
      } catch {}
      try {
        if (combineHandle) combineHandle.close()
      } catch {}
      if (bundle) {
        try {
          cleanupWorktrees(opts.projectDir, bundle.pair)
        } catch (e) {
          log.warn("cleanup: cleanupWorktrees threw", { error: String(e) })
        }
        // If we stashed but never popped (pre-seed crash), restore now.
        if (bundle.hadStash && !bundle.stashPopped) {
          try {
            stashPop(opts.projectDir)
            bundle.stashPopped = true
          } catch (e) {
            log.error("cleanup: stash pop failed — WIP may be in stash list", {
              error: String(e),
            })
          }
        }
        bundle = null
      }
    }

    const settleDone = (result: OrchestratorResult) => {
      if (settled) return
      settled = true
      try {
        opts.onDone?.(result)
      } catch (e) {
        log.warn("onDone callback threw", { error: String(e) })
      }
      // Tear down the reactive root now that we're settled.
      queueMicrotask(() => {
        try {
          dispose()
        } catch {}
      })
    }

    // ---------------------------------------------------------------------
    // Phase: review → executing
    // ---------------------------------------------------------------------

    const start = async (): Promise<void> => {
      if (phase() !== "review") return
      log.info("A/B start", {
        sessionId: opts.sessionId,
        projectDir: opts.projectDir,
        targetA: opts.targetA,
        targetB: opts.targetB,
      })

      let stash: { stashed: boolean; headSha: string }
      let pair: WorktreePair
      try {
        stash = stashDirtyState(opts.projectDir)
      } catch (err) {
        fail(
          `Failed to stash working tree — is ${opts.projectDir} a git repo? (${String(err)})`,
        )
        return
      }

      try {
        pair = createWorktrees(opts.projectDir, opts.sessionId)
      } catch (err) {
        // Restore the user's WIP before giving up.
        if (stash.stashed) {
          try {
            stashPop(opts.projectDir)
          } catch {}
        }
        fail(`Failed to create worktrees: ${String(err)}`)
        return
      }

      bundle = {
        pair,
        hadStash: stash.stashed,
        stashPopped: false,
        baselineSha: stash.headSha,
      }

      // Seed both worktrees with the user's dirty state so sessions start
      // with the WIP files. Record the seed sha for diff baselines.
      if (stash.stashed) {
        try {
          seedWorktreeFromStash(pair.a.path)
          bundle.seedSha = seedWorktreeFromStash(pair.b.path)
          // Restore WIP on main immediately so main is back to its original
          // state. From here on, no stash cleanup is needed on abort.
          stashPop(opts.projectDir)
          bundle.stashPopped = true
        } catch (err) {
          fail(`Failed to seed dirty state into worktrees: ${String(err)}`)
          return
        }
      }

      setPhase("executing")

      // Kick off both sessions in parallel
      const onUpdateA = (s: SessionStats) => setStatsA({ ...s })
      const onUpdateB = (s: SessionStats) => setStatsB({ ...s })

      handleA = runSession({
        label: "A",
        target: opts.targetA,
        prompt: opts.prompt,
        cwd: pair.a.path,
        onUpdate: onUpdateA,
      })
      handleB = runSession({
        label: "B",
        target: opts.targetB,
        prompt: opts.prompt,
        cwd: pair.b.path,
        onUpdate: onUpdateB,
      })

      let finalA: SessionStats
      let finalB: SessionStats
      try {
        const [a, b] = await Promise.all([handleA.done, handleB.done])
        finalA = a
        finalB = b
      } catch (err) {
        fail(`A/B session failed: ${String(err)}`)
        return
      }

      setStatsA({ ...finalA })
      setStatsB({ ...finalB })

      // Collect diffs for the comparison view.
      try {
        const dA = collectDiff(
          opts.projectDir,
          pair.a.branch,
          pair.a.path,
          bundle.seedSha,
        )
        const dB = collectDiff(
          opts.projectDir,
          pair.b.branch,
          pair.b.path,
          bundle.seedSha,
        )
        setDiffA(dA)
        setDiffB(dB)
      } catch (err) {
        log.error("collectDiff failed", { error: String(err) })
        // Put zero-diffs up so the comparison view still renders.
        const empty: DiffStats = {
          filesChanged: 0,
          insertions: 0,
          deletions: 0,
          diffStat: "",
          changedFiles: [],
          untrackedFiles: [],
          dirtyFiles: [],
        }
        setDiffA(empty)
        setDiffB(empty)
      }

      setPhase("comparing")
    }

    // ---------------------------------------------------------------------
    // Phase: comparing → judging
    // ---------------------------------------------------------------------

    const startJudge = async (criteriaId?: string): Promise<void> => {
      if (phase() !== "comparing") return
      const chosen = criteriaId ? (findCriteria(criteriaId) ?? getDefaultCriteria()) : criteria()
      setCriteria(chosen)

      const pair = bundle?.pair
      const dA = diffA()
      const dB = diffB()
      if (!pair || !dA || !dB) {
        fail("Judge missing state", "comparing")
        return
      }

      const prompt = buildJudgePrompt({
        prompt: opts.prompt,
        targetA: opts.targetA,
        targetB: opts.targetB,
        statsA: statsA(),
        statsB: statsB(),
        diffA: dA,
        diffB: dB,
        worktreePathA: pair.a.path,
        worktreePathB: pair.b.path,
        criteria: chosen,
      })

      setPhase("judging")
      setJudge({
        recommendation: null,
        reasoning: "",
        criteriaName: chosen.name,
        complete: false,
      })

      judgeHandle = runSession({
        label: "A", // label is cosmetic for the judge
        target: opts.targetA, // run judge on A's backend by default
        prompt,
        cwd: opts.projectDir, // read-only access to both worktrees
        additionalDirectories: [pair.a.path, pair.b.path],
        onUpdate: (s) => {
          setJudge({
            recommendation: parseRecommendation(s.output),
            reasoning: s.output,
            criteriaName: chosen.name,
            complete: s.complete,
            error: s.error,
          })
        },
      })

      await judgeHandle.done
      const finalJudge = judge()
      log.info("Judge complete", { recommendation: finalJudge?.recommendation })
      // Judge doesn't auto-advance; user chooses winner themselves.
      setPhase("comparing")
    }

    const interruptJudge = () => {
      try {
        judgeHandle?.interrupt()
      } catch {}
    }

    // ---------------------------------------------------------------------
    // Phase: comparing → combining
    // ---------------------------------------------------------------------

    const startCombine = async (): Promise<void> => {
      if (phase() !== "comparing") return
      const pair = bundle?.pair
      const dA = diffA()
      const dB = diffB()
      if (!pair || !dA || !dB) return

      const cfg: CombinePromptConfig = {
        prompt: opts.prompt,
        targetA: opts.targetA,
        targetB: opts.targetB,
        statsA: statsA(),
        statsB: statsB(),
        diffA: dA,
        diffB: dB,
        worktreePathA: pair.a.path,
        worktreePathB: pair.b.path,
        projectDir: opts.projectDir,
      }
      const prompt = buildCombinePrompt(cfg)

      setPhase("combining")
      setCombineResult({ complete: false, reasoning: "", filesTouched: [] })

      combineHandle = runSession({
        label: "A",
        target: opts.targetA,
        prompt,
        cwd: opts.projectDir, // write into main
        additionalDirectories: [pair.a.path, pair.b.path],
        onUpdate: (s) => {
          setCombineResult({
            complete: s.complete,
            reasoning: s.output,
            filesTouched: [...s.filesTouched],
            error: s.error,
          })
        },
      })
      await combineHandle.done

      // Combine session writes directly to projectDir — no merge needed.
      // Clean up worktrees and finish.
      setPhase("adopting")
      setAdoptionStatus("Cleaning up worktrees…")
      cleanup()
      setPhase("done")
      settleDone({
        phase: "done",
        winner: "combine",
        snapshot: buildSnapshot(),
        mergeMethod: "none",
      })
    }

    const interruptCombine = () => {
      try {
        combineHandle?.interrupt()
      } catch {}
    }

    // ---------------------------------------------------------------------
    // Phase: comparing → adopting
    // ---------------------------------------------------------------------

    const adopt = async (winner: Label): Promise<void> => {
      if (phase() !== "comparing") return
      if (!bundle) {
        fail("adopt: worktrees missing")
        return
      }
      const pair = bundle.pair
      const dA = diffA()
      const dB = diffB()
      if (!dA || !dB) {
        fail("adopt: diff missing")
        return
      }
      setPhase("adopting")
      setAdoptionStatus("Committing worktree changes…")
      try {
        const winnerBranch = winner === "A" ? pair.a.branch : pair.b.branch
        const winnerPath = winner === "A" ? pair.a.path : pair.b.path

        // Commit any uncommitted changes in the winner worktree so merge
        // can pick them up.
        commitWorktreeChanges(winnerPath)

        // Stash any WIP the user has accumulated on main since fork, then
        // merge, soft-reset back to pre-merge so the winner's diff appears
        // staged rather than committed, then restore the stash.
        const preAdoptStash = stashDirtyState(opts.projectDir)
        const headBefore = getHead(opts.projectDir)

        setAdoptionStatus("Merging winner…")
        const merge = mergeWinner(opts.projectDir, winnerBranch, winner)

        if (merge.success) {
          softResetTo(opts.projectDir, headBefore)
        }

        if (preAdoptStash.stashed) {
          stashPop(opts.projectDir)
        }

        if (!merge.success) {
          setAdoptionError({
            message: `Merge failed with ${merge.conflictFiles.length} conflict(s): ${merge.conflictFiles.join(", ")}`,
            winner,
            worktreePathA: pair.a.path,
            worktreePathB: pair.b.path,
          })
          setPhase("adopt-error")
          return
        }

        setAdoptionStatus("Cleaning up worktrees…")
        cleanup()

        setPhase("done")
        settleDone({
          phase: "done",
          winner,
          mergeMethod: merge.method,
          snapshot: buildSnapshot(),
        })
      } catch (err) {
        log.error("adopt threw", { error: String(err) })
        setAdoptionError({
          message: err instanceof Error ? err.message : String(err),
          winner,
          worktreePathA: bundle.pair.a.path,
          worktreePathB: bundle.pair.b.path,
        })
        setPhase("adopt-error")
      }
    }

    const retryAdopt = async (): Promise<void> => {
      const err = adoptionError()
      if (!err) return
      setAdoptionError(null)
      setPhase("comparing")
      await adopt(err.winner)
    }

    const preserveWorktreesAndExit = () => {
      const pair = bundle?.pair
      const paths = pair
        ? `Worktree A: ${pair.a.path}  Worktree B: ${pair.b.path}`
        : ""
      // Detach bundle so cleanup() doesn't remove the worktrees.
      bundle = null
      setPhase("done")
      settleDone({
        phase: "done",
        error: `Adoption failed — worktrees preserved for manual recovery. ${paths}`,
        winner: null,
      })
    }

    // ---------------------------------------------------------------------
    // Phase: any → done (user cancel)
    // ---------------------------------------------------------------------

    const cancel = () => {
      log.info("A/B cancel requested", { phase: phase() })
      cleanup()
      setPhase("done")
      settleDone({ phase: "done", winner: null })
    }

    const interruptBoth = () => {
      try {
        handleA?.interrupt()
      } catch {}
      try {
        handleB?.interrupt()
      } catch {}
    }

    const buildSnapshot = (): ComparisonSnapshot | undefined => {
      const pair = bundle?.pair
      const dA = diffA()
      const dB = diffB()
      if (!pair || !dA || !dB) return undefined
      return {
        promptA: opts.prompt,
        promptB: opts.prompt,
        targetA: opts.targetA,
        targetB: opts.targetB,
        statsA: statsA(),
        statsB: statsB(),
        diffA: dA,
        diffB: dB,
        worktreeA: pair.a,
        worktreeB: pair.b,
        judge: judge(),
        combine: combineResult(),
      }
    }

    return {
      phase,
      statsA,
      statsB,
      diffA,
      diffB,
      judge,
      combineResult,
      adoptionStatus,
      adoptionError,
      criteria,
      prompt: opts.prompt,
      targetA: opts.targetA,
      targetB: opts.targetB,
      start,
      interruptBoth,
      interruptJudge,
      interruptCombine,
      adopt,
      startJudge,
      startCombine,
      cancel,
      retryAdopt,
      preserveWorktreesAndExit,
    }
  })
}
