/**
 * Tests for the git worktree primitives.
 *
 * Uses real git repos in a temp dir instead of mocks — the primitives are
 * thin wrappers around `git`, and the whole point is that they handle
 * real-world git behavior correctly.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  cleanupWorktrees,
  collectDiff,
  commitWorktreeChanges,
  createWorktrees,
  mergeWinner,
  seedWorktreeFromStash,
  stashDirtyState,
  stashPop,
} from "../../src/utils/git-worktree"

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim()
}

function makeRepo(): { dir: string; base: string } {
  const dir = mkdtempSync(join(tmpdir(), "bantai-ab-"))
  const base = mkdtempSync(join(tmpdir(), "bantai-ab-wt-"))
  git(dir, "init", "-q", "-b", "main")
  git(dir, "config", "user.email", "test@bantai.local")
  git(dir, "config", "user.name", "Test")
  git(dir, "config", "commit.gpgsign", "false")
  writeFileSync(join(dir, "README.md"), "# hi\n")
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "init")
  return { dir, base }
}

describe("git-worktree", () => {
  let repo: { dir: string; base: string }

  beforeEach(() => {
    repo = makeRepo()
  })

  afterEach(() => {
    try {
      rmSync(repo.dir, { recursive: true, force: true })
    } catch {}
    try {
      rmSync(repo.base, { recursive: true, force: true })
    } catch {}
  })

  describe("createWorktrees / cleanupWorktrees", () => {
    it("creates two worktrees from HEAD", () => {
      const pair = createWorktrees(repo.dir, "session-abc123", { base: repo.base })

      expect(pair.a.path).toContain(repo.base)
      expect(pair.b.path).toContain(repo.base)
      expect(pair.a.branch).toStartWith("bantai-ab/session-/a-")
      expect(pair.b.branch).toStartWith("bantai-ab/session-/b-")

      // Each worktree has the initial README
      expect(readFileSync(join(pair.a.path, "README.md"), "utf-8")).toContain("# hi")
      expect(readFileSync(join(pair.b.path, "README.md"), "utf-8")).toContain("# hi")

      cleanupWorktrees(repo.dir, pair)
    })

    it("cleanupWorktrees is best-effort and idempotent", () => {
      const pair = createWorktrees(repo.dir, "sess", { base: repo.base })
      cleanupWorktrees(repo.dir, pair)
      // Second call should not throw
      cleanupWorktrees(repo.dir, pair)
    })
  })

  describe("stash lifecycle (preserves dirty state)", () => {
    it("stashDirtyState returns stashed=false on clean repo", () => {
      const result = stashDirtyState(repo.dir)
      expect(result.stashed).toBe(false)
      expect(result.headSha).toHaveLength(40)
    })

    it("stashes uncommitted tracked and untracked files", () => {
      writeFileSync(join(repo.dir, "wip.txt"), "uncommitted\n")
      writeFileSync(join(repo.dir, "untracked.txt"), "new file\n")
      git(repo.dir, "add", "wip.txt") // staged
      // untracked.txt left alone

      const result = stashDirtyState(repo.dir)
      expect(result.stashed).toBe(true)

      // Files should be gone from working tree after stash
      const status = git(repo.dir, "status", "--porcelain")
      expect(status).toBe("")

      // Pop restores
      const popped = stashPop(repo.dir)
      expect(popped).toBe(true)
      expect(readFileSync(join(repo.dir, "wip.txt"), "utf-8")).toBe("uncommitted\n")
      expect(readFileSync(join(repo.dir, "untracked.txt"), "utf-8")).toBe("new file\n")
    })

    it("round-trips full dirty state across fork", () => {
      writeFileSync(join(repo.dir, "wip.txt"), "uncommitted\n")
      git(repo.dir, "add", "wip.txt")

      const stashRes = stashDirtyState(repo.dir)
      const pair = createWorktrees(repo.dir, "sess", { base: repo.base })

      // Seed both worktrees with the stash
      seedWorktreeFromStash(pair.a.path)
      const seedB = seedWorktreeFromStash(pair.b.path)

      expect(seedB).toHaveLength(40)
      expect(readFileSync(join(pair.a.path, "wip.txt"), "utf-8")).toBe("uncommitted\n")
      expect(readFileSync(join(pair.b.path, "wip.txt"), "utf-8")).toBe("uncommitted\n")

      // Restore dirty state on main
      expect(stashRes.stashed).toBe(true)
      expect(stashPop(repo.dir)).toBe(true)
      expect(readFileSync(join(repo.dir, "wip.txt"), "utf-8")).toBe("uncommitted\n")

      cleanupWorktrees(repo.dir, pair)
    })
  })

  describe("mergeWinner (three-tier strategy)", () => {
    it("fast-forwards when main hasn't advanced", () => {
      const pair = createWorktrees(repo.dir, "sess", { base: repo.base })

      // Simulate session A making changes in worktree A
      writeFileSync(join(pair.a.path, "a.txt"), "from a\n")
      commitWorktreeChanges(pair.a.path)

      const merge = mergeWinner(repo.dir, pair.a.branch, "A")
      expect(merge.success).toBe(true)
      expect(merge.method).toBe("fast-forward")
      expect(readFileSync(join(repo.dir, "a.txt"), "utf-8")).toBe("from a\n")

      cleanupWorktrees(repo.dir, pair)
    })

    it("falls back to regular merge when main has diverged on unrelated files", () => {
      const pair = createWorktrees(repo.dir, "sess", { base: repo.base })

      // Session A touches a.txt in worktree A
      writeFileSync(join(pair.a.path, "a.txt"), "from a\n")
      commitWorktreeChanges(pair.a.path)

      // Main diverges: commit a different file
      writeFileSync(join(repo.dir, "b.txt"), "from main\n")
      git(repo.dir, "add", "-A")
      git(repo.dir, "commit", "-q", "-m", "main commit")

      const merge = mergeWinner(repo.dir, pair.a.branch, "A")
      expect(merge.success).toBe(true)
      expect(merge.method).toBe("merge")

      cleanupWorktrees(repo.dir, pair)
    })

    it("aborts and reports conflicts when files collide", () => {
      const pair = createWorktrees(repo.dir, "sess", { base: repo.base })

      // Session A edits README.md in worktree A
      writeFileSync(join(pair.a.path, "README.md"), "# from a\n")
      commitWorktreeChanges(pair.a.path)

      // Main edits README.md differently
      writeFileSync(join(repo.dir, "README.md"), "# from main\n")
      git(repo.dir, "add", "-A")
      git(repo.dir, "commit", "-q", "-m", "main commit")

      const merge = mergeWinner(repo.dir, pair.a.branch, "A")
      expect(merge.success).toBe(false)
      expect(merge.method).toBe("none")
      expect(merge.conflictFiles).toContain("README.md")

      // Main should be back to a clean state (merge --abort)
      const status = git(repo.dir, "status", "--porcelain")
      expect(status).toBe("")

      cleanupWorktrees(repo.dir, pair)
    })
  })

  describe("collectDiff", () => {
    it("reports insertions, deletions, and changed files", () => {
      const pair = createWorktrees(repo.dir, "sess", { base: repo.base })

      writeFileSync(join(pair.a.path, "new.txt"), "line1\nline2\nline3\n")
      commitWorktreeChanges(pair.a.path)

      const stats = collectDiff(repo.dir, pair.a.branch, pair.a.path)
      expect(stats.insertions).toBe(3)
      expect(stats.deletions).toBe(0)
      expect(stats.changedFiles).toContain("new.txt")
      expect(stats.filesChanged).toBeGreaterThan(0)

      cleanupWorktrees(repo.dir, pair)
    })

    it("includes untracked and uncommitted files when worktreePath provided", () => {
      const pair = createWorktrees(repo.dir, "sess", { base: repo.base })

      // Write an untracked file, don't commit
      writeFileSync(join(pair.a.path, "untracked.txt"), "hello\n")

      const stats = collectDiff(repo.dir, pair.a.branch, pair.a.path)
      expect(stats.untrackedFiles).toContain("untracked.txt")

      cleanupWorktrees(repo.dir, pair)
    })
  })

  describe("commitWorktreeChanges", () => {
    it("returns false on clean worktree", () => {
      const pair = createWorktrees(repo.dir, "sess", { base: repo.base })
      expect(commitWorktreeChanges(pair.a.path)).toBe(false)
      cleanupWorktrees(repo.dir, pair)
    })

    it("commits both tracked and untracked changes", () => {
      const pair = createWorktrees(repo.dir, "sess", { base: repo.base })

      writeFileSync(join(pair.a.path, "README.md"), "# changed\n")
      writeFileSync(join(pair.a.path, "newfile.txt"), "new\n")

      expect(commitWorktreeChanges(pair.a.path)).toBe(true)

      const status = git(pair.a.path, "status", "--porcelain")
      expect(status).toBe("")

      cleanupWorktrees(repo.dir, pair)
    })
  })
})
