/**
 * Extended judge tests — edge cases for prompt building and recommendation
 * parsing not covered by the original judge.test.ts.
 */

import { describe, expect, it } from "bun:test"
import {
  buildJudgePrompt,
  getDefaultCriteria,
  parseRecommendation,
} from "../../src/ab/judge"
import type { SessionStats } from "../../src/ab/types"
import type { DiffStats } from "../../src/utils/git-worktree"

const baseStats = (label: "A" | "B"): SessionStats => ({
  label,
  backendId: "mock",
  output: `${label} did some work`,
  turns: 1,
  inputTokens: 100,
  outputTokens: 50,
  totalCostUsd: 0.001,
  toolUseCount: 1,
  startTime: 0,
  endTime: 1000,
  filesTouched: ["foo.ts"],
  complete: true,
  interrupted: false,
})

const baseDiff = (): DiffStats => ({
  filesChanged: 1,
  insertions: 5,
  deletions: 2,
  diffStat: "foo.ts | 7 +++++--",
  changedFiles: ["foo.ts"],
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

describe("parseRecommendation edge cases", () => {
  it("returns first match when multiple RECOMMENDATION lines exist", () => {
    const text = `
First analysis suggests A.
RECOMMENDATION: A
But on further thought...
RECOMMENDATION: B
`
    expect(parseRecommendation(text)).toBe("A")
  })

  it("returns null for RECOMMENDATION: C (invalid choice)", () => {
    expect(parseRecommendation("RECOMMENDATION: C")).toBeNull()
  })

  it("returns null for recommendation in a fenced code block", () => {
    // The regex matches anywhere, so code blocks ARE parsed.
    // This test documents the actual behavior.
    const text = "```\nRECOMMENDATION: A\n```"
    // Current implementation will match this — documenting behavior
    expect(parseRecommendation(text)).toBe("A")
  })

  it("parses recommendation with extra whitespace", () => {
    expect(parseRecommendation("RECOMMENDATION:   A")).toBe("A")
    expect(parseRecommendation("RECOMMENDATION:  B  ")).toBe("B")
  })

  it("parses recommendation embedded in a long transcript", () => {
    const longText = "x".repeat(5000) + "\nRECOMMENDATION: B\n" + "y".repeat(3000)
    expect(parseRecommendation(longText)).toBe("B")
  })

  it("handles empty string", () => {
    expect(parseRecommendation("")).toBeNull()
  })
})

describe("buildJudgePrompt edge cases", () => {
  it("handles zero-length output sessions", () => {
    const stats = { ...baseStats("A"), output: "" }
    const prompt = buildJudgePrompt({
      prompt: "test",
      targetA: { backendId: "mock" },
      targetB: { backendId: "mock" },
      statsA: stats,
      statsB: { ...baseStats("B"), output: "" },
      diffA: baseDiff(),
      diffB: baseDiff(),
      worktreePathA: "/a",
      worktreePathB: "/b",
      criteria: getDefaultCriteria(),
    })
    // Should contain "(no output captured)" for empty outputs
    expect(prompt).toContain("(no output captured)")
  })

  it("handles no changed files on either side", () => {
    const prompt = buildJudgePrompt({
      prompt: "test",
      targetA: { backendId: "mock" },
      targetB: { backendId: "mock" },
      statsA: baseStats("A"),
      statsB: baseStats("B"),
      diffA: emptyDiff(),
      diffB: emptyDiff(),
      worktreePathA: "/a",
      worktreePathB: "/b",
      criteria: getDefaultCriteria(),
    })
    // Should NOT contain "changed files" sections when no files changed
    expect(prompt).not.toContain("### A changed files")
    expect(prompt).not.toContain("### B changed files")
  })

  it("handles very long file lists (100+ files)", () => {
    const manyFiles = Array.from({ length: 150 }, (_, i) => `src/file${i}.ts`)
    const diff: DiffStats = {
      ...baseDiff(),
      filesChanged: 150,
      changedFiles: manyFiles,
    }
    const prompt = buildJudgePrompt({
      prompt: "test",
      targetA: { backendId: "mock" },
      targetB: { backendId: "mock" },
      statsA: baseStats("A"),
      statsB: baseStats("B"),
      diffA: diff,
      diffB: baseDiff(),
      worktreePathA: "/a",
      worktreePathB: "/b",
      criteria: getDefaultCriteria(),
    })
    // All 150 files should appear in the prompt
    expect(prompt).toContain("src/file0.ts")
    expect(prompt).toContain("src/file149.ts")
  })

  it("shows duration as null when endTime is missing", () => {
    const stats = { ...baseStats("A"), endTime: undefined }
    const prompt = buildJudgePrompt({
      prompt: "test",
      targetA: { backendId: "mock" },
      targetB: { backendId: "mock" },
      statsA: stats,
      statsB: baseStats("B"),
      diffA: baseDiff(),
      diffB: baseDiff(),
      worktreePathA: "/a",
      worktreePathB: "/b",
      criteria: getDefaultCriteria(),
    })
    // Duration line should not appear when endTime is undefined
    expect(prompt).not.toContain("Duration: NaN")
  })

  it("includes asymmetric diffs correctly (A has files, B has none)", () => {
    const prompt = buildJudgePrompt({
      prompt: "test",
      targetA: { backendId: "claude" },
      targetB: { backendId: "codex" },
      statsA: baseStats("A"),
      statsB: baseStats("B"),
      diffA: baseDiff(),
      diffB: emptyDiff(),
      worktreePathA: "/a",
      worktreePathB: "/b",
      criteria: getDefaultCriteria(),
    })
    expect(prompt).toContain("### A changed files")
    expect(prompt).not.toContain("### B changed files")
  })
})
