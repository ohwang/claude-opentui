import { describe, expect, it } from "bun:test"
import {
  buildJudgePrompt,
  findCriteria,
  getDefaultCriteria,
  JUDGE_TEMPLATES,
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

describe("judge criteria", () => {
  it("ships three templates", () => {
    expect(JUDGE_TEMPLATES.length).toBe(3)
    expect(JUDGE_TEMPLATES.map((t) => t.id)).toEqual([
      "quality",
      "angles",
      "stability",
    ])
  })

  it("default is quality showdown", () => {
    expect(getDefaultCriteria().id).toBe("quality")
  })

  it("findCriteria returns named template or undefined", () => {
    expect(findCriteria("stability")?.name).toBe("Stability First")
    expect(findCriteria("nonexistent")).toBeUndefined()
  })
})

describe("buildJudgePrompt", () => {
  it("includes both targets, both stats, both worktree paths, and the criteria", () => {
    const prompt = buildJudgePrompt({
      prompt: "implement foo",
      targetA: { backendId: "claude", model: "sonnet-4" },
      targetB: { backendId: "codex" },
      statsA: baseStats("A"),
      statsB: baseStats("B"),
      diffA: baseDiff(),
      diffB: baseDiff(),
      worktreePathA: "/tmp/wt-a",
      worktreePathB: "/tmp/wt-b",
      criteria: getDefaultCriteria(),
    })

    expect(prompt).toContain("implement foo")
    expect(prompt).toContain("claude (sonnet-4)")
    expect(prompt).toContain("codex")
    expect(prompt).toContain("/tmp/wt-a")
    expect(prompt).toContain("/tmp/wt-b")
    expect(prompt).toContain("RECOMMENDATION: A")
    expect(prompt).toContain("foo.ts")
  })

  it("truncates very long session output", () => {
    const big = "x".repeat(5000)
    const stats = { ...baseStats("A"), output: big }
    const prompt = buildJudgePrompt({
      prompt: "p",
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
    expect(prompt).toContain("[truncated")
  })
})

describe("parseRecommendation", () => {
  it("parses A / B / TIE in any case", () => {
    expect(parseRecommendation("RECOMMENDATION: A")).toBe("A")
    expect(parseRecommendation("recommendation: b")).toBe("B")
    expect(parseRecommendation("Recommendation: Tie")).toBe("tie")
  })

  it("returns null when no recommendation present", () => {
    expect(parseRecommendation("hmm not sure")).toBeNull()
  })

  it("ignores stray RECOMMENDATION text without A/B/TIE", () => {
    expect(parseRecommendation("My recommendation is unclear")).toBeNull()
  })

  it("matches even when wrapped in markdown emphasis", () => {
    expect(parseRecommendation("**RECOMMENDATION: B**")).toBe("B")
  })
})
