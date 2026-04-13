/**
 * Git Worktree Utility — reusable primitives for parallel session isolation.
 *
 * Ported from claude-exmode (`src/git/{worktree,stash,merge,diff,commit-worktree}.ts`)
 * into a single cohesive module so A/B comparison and (future) subagent
 * isolation can share the same primitives.
 *
 * Safety model:
 *
 * - Never throws unless the caller explicitly asks (create*, mergeWinner) —
 *   cleanup/best-effort helpers swallow errors and log them.
 * - Preserves the user's uncommitted state via stash-push before fork,
 *   stash-pop after worktrees are seeded.
 * - Uses `--include-untracked` so WIP files that aren't yet `git add`-ed are
 *   still preserved.
 * - All subprocesses run via `execFileSync` with an array argv (never a
 *   shell string) so filenames containing spaces/quotes are safe.
 */

import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { log } from "./logger"

const DEFAULT_WORKTREE_BASE = join(homedir(), ".bantai", "worktrees")

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Worktree {
  /** Absolute path to the worktree on disk. */
  path: string
  /** Name of the branch that was created for the worktree. */
  branch: string
}

export interface WorktreePair {
  a: Worktree
  b: Worktree
}

export interface StashResult {
  /** True when `git stash push` actually stashed something. */
  stashed: boolean
  /** HEAD SHA at the time of the stash (unchanged by a stash). */
  headSha: string
}

export interface DiffStats {
  filesChanged: number
  insertions: number
  deletions: number
  /** Output of `git diff --stat base...branch`. */
  diffStat: string
  /** Flat list of all changed/new/dirty files. */
  changedFiles: string[]
  /** Files that are untracked in the worktree (never git-added). */
  untrackedFiles: string[]
  /** Files modified in the worktree but not committed. */
  dirtyFiles: string[]
}

export type MergeMethod = "fast-forward" | "merge" | "none"

export interface MergeResult {
  success: boolean
  method: MergeMethod
  /** Files that ended up in a conflict state when merge failed. */
  conflictFiles: string[]
}

// ---------------------------------------------------------------------------
// Worktree lifecycle
// ---------------------------------------------------------------------------

/**
 * Create two worktrees off HEAD — one per A/B session. Branch names embed the
 * caller-supplied `sessionId` prefix so multiple concurrent comparisons don't
 * collide.
 *
 * Throws if `git worktree add` fails (e.g. base path not inside a repo).
 */
export function createWorktrees(
  projectDir: string,
  sessionId: string,
  opts: { base?: string } = {},
): WorktreePair {
  const base = opts.base ?? DEFAULT_WORKTREE_BASE
  mkdirSync(base, { recursive: true })

  const shortId = sessionId.slice(0, 8)
  const ts = Date.now()

  const a: Worktree = {
    branch: `bantai-ab/${shortId}/a-${ts}`,
    path: join(base, `${shortId}-a-${ts}`),
  }
  const b: Worktree = {
    branch: `bantai-ab/${shortId}/b-${ts}`,
    path: join(base, `${shortId}-b-${ts}`),
  }

  log.info("createWorktrees: creating A", { path: a.path, branch: a.branch })
  execFileSync("git", ["worktree", "add", "-b", a.branch, a.path, "HEAD"], {
    cwd: projectDir,
    stdio: "ignore",
  })

  log.info("createWorktrees: creating B", { path: b.path, branch: b.branch })
  execFileSync("git", ["worktree", "add", "-b", b.branch, b.path, "HEAD"], {
    cwd: projectDir,
    stdio: "ignore",
  })

  return { a, b }
}

/**
 * Remove both worktrees and delete their branches. Best-effort — never throws.
 * Safe to call multiple times (idempotent at the git level).
 */
export function cleanupWorktrees(projectDir: string, pair: WorktreePair): void {
  log.info("cleanupWorktrees: removing worktrees and branches")
  for (const wt of [pair.a, pair.b]) {
    try {
      execFileSync("git", ["worktree", "remove", "--force", wt.path], {
        cwd: projectDir,
        stdio: "ignore",
      })
      log.debug("cleanupWorktrees: removed worktree", { path: wt.path })
    } catch (e) {
      log.warn("cleanupWorktrees: failed to remove worktree", {
        path: wt.path,
        error: String(e),
      })
    }
    try {
      execFileSync("git", ["branch", "-D", wt.branch], {
        cwd: projectDir,
        stdio: "ignore",
      })
      log.debug("cleanupWorktrees: deleted branch", { branch: wt.branch })
    } catch (e) {
      log.warn("cleanupWorktrees: failed to delete branch", {
        branch: wt.branch,
        error: String(e),
      })
    }
  }
  try {
    execFileSync("git", ["worktree", "prune"], {
      cwd: projectDir,
      stdio: "ignore",
    })
  } catch {
    // prune is a tidy-up — failure is never fatal.
  }
}

// ---------------------------------------------------------------------------
// Stash lifecycle — preserves the user's uncommitted work across the fork.
// ---------------------------------------------------------------------------

/**
 * Stash everything dirty (staged + unstaged + untracked) without modifying
 * commit history. Returns whether anything was stashed and the unchanged HEAD
 * SHA (useful as a diff baseline or for a post-adopt soft reset).
 */
export function stashDirtyState(cwd: string): StashResult {
  const headSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf-8",
  }).trim()

  const status = execFileSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf-8",
  }).trim()
  if (status === "") {
    log.info("stashDirtyState: working tree clean, nothing to stash")
    return { stashed: false, headSha }
  }

  log.info("stashDirtyState: stashing dirty state (including untracked)")
  execFileSync(
    "git",
    ["stash", "push", "--include-untracked", "-m", "bantai-ab: temp stash"],
    { cwd, stdio: "ignore" },
  )
  return { stashed: true, headSha }
}

/**
 * Pop the most recent stash entry. Returns true on clean pop, false if git
 * reported conflicts (in which case the stash is dropped to avoid lingering;
 * the caller should surface the stash ref to the user before calling this).
 */
export function stashPop(cwd: string): boolean {
  try {
    execFileSync("git", ["stash", "pop"], { cwd, stdio: "ignore" })
    log.info("stashPop: restored dirty state")
    return true
  } catch {
    log.warn("stashPop: conflicts during pop, dropping stash")
    try {
      execFileSync("git", ["stash", "drop"], { cwd, stdio: "ignore" })
    } catch {
      // ignore
    }
    return false
  }
}

/** Apply (not pop) the top stash into a worktree. */
export function stashApply(cwd: string): void {
  log.info("stashApply: applying stash", { cwd })
  execFileSync("git", ["stash", "apply"], { cwd, stdio: "ignore" })
}

/**
 * Seed a worktree with the top stash entry and commit it so the session's
 * starting point contains the user's WIP files as tracked content.
 *
 * Returns the seed-commit SHA; callers pass this as the diff baseline so
 * `collectDiff()` reports only session-added changes, not the inherited WIP.
 */
export function seedWorktreeFromStash(worktreePath: string): string {
  stashApply(worktreePath)
  execFileSync("git", ["add", "-A"], { cwd: worktreePath, stdio: "ignore" })

  const status = execFileSync("git", ["status", "--porcelain"], {
    cwd: worktreePath,
    encoding: "utf-8",
  }).trim()
  if (status === "") {
    log.info("seedWorktreeFromStash: nothing to commit after apply")
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: worktreePath,
      encoding: "utf-8",
    }).trim()
  }

  execFileSync(
    "git",
    ["commit", "--no-verify", "-m", "bantai-ab: seed dirty state"],
    { cwd: worktreePath, stdio: "ignore" },
  )
  log.info("seedWorktreeFromStash: committed seeded dirty state")
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: worktreePath,
    encoding: "utf-8",
  }).trim()
}

// ---------------------------------------------------------------------------
// Merge lifecycle
// ---------------------------------------------------------------------------

/** Current HEAD SHA for `cwd`. */
export function getHead(cwd: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf-8",
  }).trim()
}

/** Soft-reset HEAD to `sha`, leaving all changes staged. */
export function softResetTo(cwd: string, sha: string): void {
  log.info("softResetTo", { sha })
  execFileSync("git", ["reset", "--soft", sha], { cwd, stdio: "ignore" })
}

/**
 * Commit any uncommitted changes in a worktree so `git merge` can see them.
 * Returns true if a commit was made, false when the worktree was already
 * clean. Never throws for a clean worktree.
 */
export function commitWorktreeChanges(worktreePath: string): boolean {
  log.info("commitWorktreeChanges", { worktreePath })
  execFileSync("git", ["add", "-A"], { cwd: worktreePath, stdio: "ignore" })

  const status = execFileSync("git", ["status", "--porcelain"], {
    cwd: worktreePath,
    encoding: "utf-8",
  })

  if (status.trim() === "") {
    log.info("commitWorktreeChanges: nothing to commit")
    return false
  }

  log.info("commitWorktreeChanges: committing")
  execFileSync(
    "git",
    ["commit", "--no-verify", "-m", "bantai-ab: commit worktree changes"],
    { cwd: worktreePath, stdio: "ignore" },
  )
  return true
}

/**
 * Three-tier merge strategy: fast-forward → regular merge → abort-on-conflict.
 * Never throws — returns a structured MergeResult the caller can render.
 */
export function mergeWinner(
  projectDir: string,
  branch: string,
  label: string,
): MergeResult {
  log.info("mergeWinner: attempting fast-forward", { branch })
  try {
    execFileSync("git", ["merge", "--ff-only", branch], {
      cwd: projectDir,
      encoding: "utf-8",
      stdio: "pipe",
    })
    log.info("mergeWinner: fast-forward succeeded")
    return { success: true, method: "fast-forward", conflictFiles: [] }
  } catch {
    log.info("mergeWinner: fast-forward failed, trying regular merge")
  }

  try {
    execFileSync(
      "git",
      ["merge", branch, "-m", `Merge bantai-ab winner: ${label}`],
      { cwd: projectDir, encoding: "utf-8", stdio: "pipe" },
    )
    log.info("mergeWinner: regular merge succeeded")
    return { success: true, method: "merge", conflictFiles: [] }
  } catch {
    log.warn("mergeWinner: merge conflict detected")
  }

  let conflictFiles: string[] = []
  try {
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: projectDir,
      encoding: "utf-8",
    })
    conflictFiles = status
      .split("\n")
      .filter(
        (l) =>
          l.startsWith("UU") || l.startsWith("AA") || l.startsWith("DD"),
      )
      .map((l) => l.slice(3).trim())
  } catch {
    // best-effort
  }

  try {
    execFileSync("git", ["merge", "--abort"], {
      cwd: projectDir,
      stdio: "ignore",
    })
    log.info("mergeWinner: merge aborted")
  } catch {
    // ignore
  }

  return { success: false, method: "none", conflictFiles }
}

// ---------------------------------------------------------------------------
// Diff collection
// ---------------------------------------------------------------------------

function gitExec(args: string[], cwd: string, fallback = ""): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim()
  } catch {
    return fallback
  }
}

/**
 * Collect diff stats between `baseSha` (default HEAD) and the worktree
 * branch. Includes untracked + uncommitted files so the comparison view
 * doesn't hide WIP that the session never committed.
 */
export function collectDiff(
  projectDir: string,
  branch: string,
  worktreePath?: string,
  baseSha?: string,
): DiffStats {
  const base = baseSha ?? "HEAD"
  log.info("collectDiff", { base, branch, worktreePath })

  const diffStat = gitExec(
    ["diff", "--stat", `${base}...${branch}`],
    projectDir,
  )
  const nameOnly = gitExec(
    ["diff", "--name-only", `${base}...${branch}`],
    projectDir,
  )
  const numstat = gitExec(
    ["diff", "--numstat", `${base}...${branch}`],
    projectDir,
  )
  const untrackedRaw = worktreePath
    ? gitExec(["ls-files", "--others", "--exclude-standard"], worktreePath)
    : ""
  const dirtyRaw = worktreePath
    ? gitExec(["diff", "--name-only"], worktreePath)
    : ""

  const changedFiles = nameOnly ? nameOnly.split("\n").filter(Boolean) : []

  let insertions = 0
  let deletions = 0
  if (numstat) {
    for (const line of numstat.split("\n")) {
      const [add, del] = line.split("\t")
      if (add && add !== "-") insertions += parseInt(add, 10) || 0
      if (del && del !== "-") deletions += parseInt(del, 10) || 0
    }
  }

  const untrackedFiles = untrackedRaw
    ? untrackedRaw.split("\n").filter(Boolean)
    : []
  const committedSet = new Set([...changedFiles, ...untrackedFiles])
  const dirtyFiles = dirtyRaw
    ? dirtyRaw.split("\n").filter((f) => f && !committedSet.has(f))
    : []

  return {
    filesChanged: changedFiles.length + untrackedFiles.length + dirtyFiles.length,
    insertions,
    deletions,
    diffStat,
    changedFiles: [...changedFiles, ...untrackedFiles, ...dirtyFiles],
    untrackedFiles,
    dirtyFiles,
  }
}
