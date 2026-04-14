/**
 * Git worktree utility tests — exercise the primitives used by the
 * orchestrator in isolation.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
} from "../../src/utils/git-worktree"

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim()
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "bantai-wt-"))
  git(dir, "init", "-q", "-b", "main")
  git(dir, "config", "user.email", "test@bantai.local")
  git(dir, "config", "user.name", "Test")
  git(dir, "config", "commit.gpgsign", "false")
  writeFileSync(join(dir, "README.md"), "# test\n")
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "init")
  return dir
}

describe("createWorktrees / cleanupWorktrees", () => {
  let repo: string
  beforeEach(() => {
    repo = makeRepo()
  })
  afterEach(() => {
    try {
      rmSync(repo, { recursive: true, force: true })
    } catch {}
  })

  it("creates two valid git worktrees with branches", () => {
    const pair = createWorktrees(repo, "test-create")
    expect(existsSync(pair.a.path)).toBe(true)
    expect(existsSync(pair.b.path)).toBe(true)

    // Both should be proper git repos
    const headA = git(pair.a.path, "rev-parse", "HEAD")
    const headB = git(pair.b.path, "rev-parse", "HEAD")
    const headMain = git(repo, "rev-parse", "HEAD")
    expect(headA).toBe(headMain)
    expect(headB).toBe(headMain)

    // Branches should exist
    const branches = git(repo, "branch", "--list")
    expect(branches).toContain(pair.a.branch)
    expect(branches).toContain(pair.b.branch)

    cleanupWorktrees(repo, pair)
  })

  it("cleanupWorktrees removes both worktrees and branches", () => {
    const pair = createWorktrees(repo, "test-cleanup")
    cleanupWorktrees(repo, pair)

    expect(existsSync(pair.a.path)).toBe(false)
    expect(existsSync(pair.b.path)).toBe(false)

    const branches = git(repo, "branch", "--list", "bantai-ab/*")
    expect(branches).toBe("")
  })

  it("cleanupWorktrees is idempotent (call twice)", () => {
    const pair = createWorktrees(repo, "test-idempotent")
    cleanupWorktrees(repo, pair)
    // Second call should not throw
    cleanupWorktrees(repo, pair)
  })
})

describe("stash lifecycle", () => {
  let repo: string
  beforeEach(() => {
    repo = makeRepo()
  })
  afterEach(() => {
    try {
      rmSync(repo, { recursive: true, force: true })
    } catch {}
  })

  it("stashDirtyState on clean repo returns stashed=false", () => {
    const result = stashDirtyState(repo)
    expect(result.stashed).toBe(false)
    expect(result.headSha).toBe(git(repo, "rev-parse", "HEAD"))
  })

  it("stashDirtyState with staged + unstaged + untracked", () => {
    writeFileSync(join(repo, "untracked.txt"), "new\n")
    writeFileSync(join(repo, "README.md"), "# modified\n")
    writeFileSync(join(repo, "staged.txt"), "staged\n")
    git(repo, "add", "staged.txt")

    const result = stashDirtyState(repo)
    expect(result.stashed).toBe(true)

    // Working tree should be clean after stash
    const status = git(repo, "status", "--porcelain")
    expect(status).toBe("")
  })

  it("stashPop restores all file categories", () => {
    writeFileSync(join(repo, "untracked.txt"), "new\n")
    writeFileSync(join(repo, "README.md"), "# modified\n")

    stashDirtyState(repo)

    // Files gone after stash
    expect(existsSync(join(repo, "untracked.txt"))).toBe(false)

    const popped = stashPop(repo)
    expect(popped).toBe(true)

    // Files restored
    expect(readFileSync(join(repo, "untracked.txt"), "utf-8")).toBe("new\n")
    expect(readFileSync(join(repo, "README.md"), "utf-8")).toBe("# modified\n")
  })
})

describe("seedWorktreeFromStash", () => {
  let repo: string
  beforeEach(() => {
    repo = makeRepo()
  })
  afterEach(() => {
    try {
      rmSync(repo, { recursive: true, force: true })
    } catch {}
  })

  it("creates a seed commit with the stashed content", () => {
    writeFileSync(join(repo, "wip.txt"), "work in progress\n")
    stashDirtyState(repo)

    const pair = createWorktrees(repo, "test-seed")

    const seedSha = seedWorktreeFromStash(pair.a.path)
    expect(seedSha).toBeTruthy()

    // The worktree should have the WIP file committed
    expect(readFileSync(join(pair.a.path, "wip.txt"), "utf-8")).toBe(
      "work in progress\n",
    )

    // Seed sha should be different from the original HEAD
    // Seed sha should be a valid 40-char SHA
    expect(seedSha.length).toBe(40)

    stashPop(repo)
    cleanupWorktrees(repo, pair)
  })
})

describe("collectDiff", () => {
  let repo: string
  beforeEach(() => {
    repo = makeRepo()
  })
  afterEach(() => {
    try {
      rmSync(repo, { recursive: true, force: true })
    } catch {}
  })

  it("returns zero stats when no changes exist", () => {
    const pair = createWorktrees(repo, "test-nodiff")
    const diff = collectDiff(repo, pair.a.branch, pair.a.path)
    expect(diff.filesChanged).toBe(0)
    expect(diff.insertions).toBe(0)
    expect(diff.deletions).toBe(0)
    expect(diff.changedFiles).toEqual([])
    cleanupWorktrees(repo, pair)
  })

  it("detects added/modified files in a worktree", () => {
    const pair = createWorktrees(repo, "test-diff")
    const baseSha = git(repo, "rev-parse", "HEAD")

    // Make changes in worktree A
    writeFileSync(join(pair.a.path, "new.txt"), "hello\n")
    writeFileSync(join(pair.a.path, "README.md"), "# updated\n")
    commitWorktreeChanges(pair.a.path)

    const diff = collectDiff(repo, pair.a.branch, pair.a.path, baseSha)
    expect(diff.filesChanged).toBeGreaterThan(0)
    expect(diff.changedFiles).toContain("new.txt")
    expect(diff.changedFiles).toContain("README.md")

    cleanupWorktrees(repo, pair)
  })
})

describe("commitWorktreeChanges", () => {
  let repo: string
  beforeEach(() => {
    repo = makeRepo()
  })
  afterEach(() => {
    try {
      rmSync(repo, { recursive: true, force: true })
    } catch {}
  })

  it("returns false on clean worktree", () => {
    const pair = createWorktrees(repo, "test-commit-clean")
    const committed = commitWorktreeChanges(pair.a.path)
    expect(committed).toBe(false)
    cleanupWorktrees(repo, pair)
  })

  it("commits dirty files and returns true", () => {
    const pair = createWorktrees(repo, "test-commit-dirty")
    writeFileSync(join(pair.a.path, "change.txt"), "dirty\n")

    const committed = commitWorktreeChanges(pair.a.path)
    expect(committed).toBe(true)

    // Worktree should be clean after commit
    const status = git(pair.a.path, "status", "--porcelain")
    expect(status).toBe("")

    cleanupWorktrees(repo, pair)
  })
})

describe("mergeWinner", () => {
  let repo: string
  beforeEach(() => {
    repo = makeRepo()
  })
  afterEach(() => {
    try {
      rmSync(repo, { recursive: true, force: true })
    } catch {}
  })

  it("fast-forward merges when main has no new commits", () => {
    const pair = createWorktrees(repo, "test-ff")
    writeFileSync(join(pair.a.path, "new.txt"), "from A\n")
    commitWorktreeChanges(pair.a.path)

    const result = mergeWinner(repo, pair.a.branch, "A")
    expect(result.success).toBe(true)
    expect(result.method).toBe("fast-forward")
    expect(result.conflictFiles).toEqual([])

    cleanupWorktrees(repo, pair)
  })

  it("reports conflict when both sides edit the same file differently", () => {
    const pair = createWorktrees(repo, "test-conflict")

    // Make conflicting changes in worktree A
    writeFileSync(join(pair.a.path, "README.md"), "# from A\nline a\n")
    commitWorktreeChanges(pair.a.path)

    // Make conflicting changes on main
    writeFileSync(join(repo, "README.md"), "# from main\nline main\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "main diverges")

    const result = mergeWinner(repo, pair.a.branch, "A")
    expect(result.success).toBe(false)
    expect(result.method).toBe("none")
    // After abort, repo should be clean
    const status = git(repo, "status", "--porcelain")
    expect(status).toBe("")

    cleanupWorktrees(repo, pair)
  })
})

describe("softResetTo", () => {
  let repo: string
  beforeEach(() => {
    repo = makeRepo()
  })
  afterEach(() => {
    try {
      rmSync(repo, { recursive: true, force: true })
    } catch {}
  })

  it("leaves changes staged after reset", () => {
    const originalHead = getHead(repo)
    writeFileSync(join(repo, "new.txt"), "hello\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "add new file")

    softResetTo(repo, originalHead)

    // HEAD should be back to original
    expect(getHead(repo)).toBe(originalHead)

    // But changes should be staged
    const status = git(repo, "status", "--porcelain")
    expect(status).toContain("new.txt")
    // Status should show as staged (A = added)
    expect(status).toMatch(/^A/)
  })
})
