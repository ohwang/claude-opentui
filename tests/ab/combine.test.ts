/**
 * Combine prompt builder tests.
 */

import { describe, expect, it } from "bun:test"
import { buildCombinePrompt } from "../../src/ab/combine"
import type { SessionStats } from "../../src/ab/types"
import type { DiffStats } from "../../src/utils/git-worktree"

const baseStats = (label: "A" | "B"): SessionStats => ({
  label,
  backendId: "mock",
  output: `${label} did some work here`,
  turns: 2,
  inputTokens: 200,
  outputTokens: 100,
  totalCostUsd: 0.005,
  toolUseCount: 3,
  startTime: 0,
  endTime: 5000,
  filesTouched: ["foo.ts", "bar.ts"],
  complete: true,
  interrupted: false,
})

const baseDiff = (files: string[] = ["foo.ts"]): DiffStats => ({
  filesChanged: files.length,
  insertions: 10,
  deletions: 3,
  diffStat: files.map((f) => `${f} | 13 +++++++---`).join("\n"),
  changedFiles: files,
  untrackedFiles: [],
  dirtyFiles: [],
})

const emptyDiff = (): DiffStats => ({
  filesChanged: 0,
  insertions: 0,
  deletions: 0,
  diffStat: "",
  changedFiles: [],
  untrackedFiles: [],
  dirtyFiles: [],
})

describe("buildCombinePrompt", () => {
  it("includes both worktree paths as read-only references", () => {
    const prompt = buildCombinePrompt({
      prompt: "implement foo",
      targetA: { backendId: "claude", model: "opus" },
      targetB: { backendId: "codex" },
      statsA: baseStats("A"),
      statsB: baseStats("B"),
      diffA: baseDiff(),
      diffB: baseDiff(["bar.ts"]),
      worktreePathA: "/tmp/wt-a",
      worktreePathB: "/tmp/wt-b",
      projectDir: "/home/user/project",
    })

    expect(prompt).toContain("/tmp/wt-a")
    expect(prompt).toContain("/tmp/wt-b")
    expect(prompt).toContain("READ-ONLY")
  })

  it("includes projectDir as the write target", () => {
    const prompt = buildCombinePrompt({
      prompt: "test",
      targetA: { backendId: "mock" },
      targetB: { backendId: "mock" },
      statsA: baseStats("A"),
      statsB: baseStats("B"),
      diffA: baseDiff(),
      diffB: baseDiff(),
      worktreePathA: "/a",
      worktreePathB: "/b",
      projectDir: "/home/user/myproject",
    })

    expect(prompt).toContain("/home/user/myproject")
    expect(prompt).toContain("Write your changes to /home/user/myproject")
  })

  it("truncates long session outputs", () => {
    const longOutput = "x".repeat(5000)
    const stats = { ...baseStats("A"), output: longOutput }
    const prompt = buildCombinePrompt({
      prompt: "test",
      targetA: { backendId: "mock" },
      targetB: { backendId: "mock" },
      statsA: stats,
      statsB: baseStats("B"),
      diffA: baseDiff(),
      diffB: baseDiff(),
      worktreePathA: "/a",
      worktreePathB: "/b",
      projectDir: "/proj",
    })

    expect(prompt).toContain("[truncated")
  })

  it("handles no changed files on either side", () => {
    const prompt = buildCombinePrompt({
      prompt: "test",
      targetA: { backendId: "mock" },
      targetB: { backendId: "mock" },
      statsA: baseStats("A"),
      statsB: baseStats("B"),
      diffA: emptyDiff(),
      diffB: emptyDiff(),
      worktreePathA: "/a",
      worktreePathB: "/b",
      projectDir: "/proj",
    })

    expect(prompt).not.toContain("### A changed files")
    expect(prompt).not.toContain("### B changed files")
  })

  it("handles asymmetric diffs (A has files, B has none)", () => {
    const prompt = buildCombinePrompt({
      prompt: "test",
      targetA: { backendId: "mock" },
      targetB: { backendId: "mock" },
      statsA: baseStats("A"),
      statsB: baseStats("B"),
      diffA: baseDiff(["src/auth.ts", "src/routes.ts"]),
      diffB: emptyDiff(),
      worktreePathA: "/a",
      worktreePathB: "/b",
      projectDir: "/proj",
    })

    expect(prompt).toContain("### A changed files")
    expect(prompt).toContain("src/auth.ts")
    expect(prompt).toContain("src/routes.ts")
    expect(prompt).not.toContain("### B changed files")
  })

  it("includes the original prompt", () => {
    const prompt = buildCombinePrompt({
      prompt: "refactor the auth module to use JWT",
      targetA: { backendId: "claude" },
      targetB: { backendId: "codex" },
      statsA: baseStats("A"),
      statsB: baseStats("B"),
      diffA: baseDiff(),
      diffB: baseDiff(),
      worktreePathA: "/a",
      worktreePathB: "/b",
      projectDir: "/proj",
    })

    expect(prompt).toContain("refactor the auth module to use JWT")
  })

  it("includes target labels with model info", () => {
    const prompt = buildCombinePrompt({
      prompt: "test",
      targetA: { backendId: "claude", model: "sonnet-4-6" },
      targetB: { backendId: "codex" },
      statsA: baseStats("A"),
      statsB: baseStats("B"),
      diffA: baseDiff(),
      diffB: baseDiff(),
      worktreePathA: "/a",
      worktreePathB: "/b",
      projectDir: "/proj",
    })

    expect(prompt).toContain("claude (sonnet-4-6)")
    expect(prompt).toContain("codex")
  })
})
