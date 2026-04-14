/**
 * Edge-case tests for /ab argument parsing — covers gaps not in the original
 * parse-args.test.ts suite.
 */

import { describe, expect, it } from "bun:test"
import { parseAbArgs } from "../../src/commands/builtin/ab"

describe("parseAbArgs edge cases", () => {
  it("returns empty prompt and no targets for empty string input", () => {
    const r = parseAbArgs("")
    expect(r.prompt).toBe("")
    expect(r.targetA).toBeUndefined()
    expect(r.targetB).toBeUndefined()
    expect(r.errors).toEqual([])
  })

  it("returns empty prompt for whitespace-only input", () => {
    const r = parseAbArgs("   \t  ")
    expect(r.prompt).toBe("")
    expect(r.errors).toEqual([])
  })

  it("treats unknown flags as part of the prompt", () => {
    const r = parseAbArgs("--x=foo do stuff --y=bar")
    expect(r.prompt).toBe("--x=foo do stuff --y=bar")
    expect(r.targetA).toBeUndefined()
    expect(r.errors).toEqual([])
  })

  it("handles --a= with empty value (no backend)", () => {
    const r = parseAbArgs("--a= test prompt")
    // Empty string is not a known backend → error
    expect(r.errors.length).toBeGreaterThan(0)
    expect(r.errors[0]).toMatch(/Unknown backend/)
  })

  it("handles backend with empty model (trailing colon --a=claude:)", () => {
    const r = parseAbArgs("--a=claude: test prompt")
    // model should be undefined (empty string → undefined after || undefined)
    expect(r.targetA).toBeDefined()
    expect(r.targetA!.backendId).toBe("claude")
    expect(r.targetA!.model).toBeUndefined()
    expect(r.errors).toEqual([])
  })

  it("last --a= wins when specified twice", () => {
    const r = parseAbArgs("--a=mock --a=claude test")
    // The loop overwrites targetA, so last one wins
    expect(r.targetA?.backendId).toBe("claude")
    expect(r.prompt).toBe("test")
  })

  it("handles very long prompt without crashing", () => {
    const longPrompt = "word ".repeat(2000).trim()
    const r = parseAbArgs(longPrompt)
    expect(r.prompt).toBe(longPrompt)
    expect(r.errors).toEqual([])
  })

  it("handles special characters in prompt (unicode)", () => {
    const r = parseAbArgs("add emoji support \u2728\ud83d\ude80 to the parser")
    expect(r.prompt).toBe("add emoji support \u2728\ud83d\ude80 to the parser")
    expect(r.errors).toEqual([])
  })

  it("parses single-quoted prompt segments", () => {
    const r = parseAbArgs("--a=mock --b=mock 'say hello world'")
    expect(r.prompt).toBe("say hello world")
  })

  it("handles mixed flags and prompt in various positions", () => {
    const r = parseAbArgs("refactor --a=claude the module --b=codex please")
    expect(r.prompt).toBe("refactor the module please")
    expect(r.targetA?.backendId).toBe("claude")
    expect(r.targetB?.backendId).toBe("codex")
  })

  it("handles --criteria with --a and --b together", () => {
    const r = parseAbArgs(
      "--a=claude:opus --b=codex --criteria=stability harden it",
    )
    expect(r.targetA).toEqual({ backendId: "claude", model: "opus" })
    expect(r.targetB).toEqual({ backendId: "codex", model: undefined })
    expect(r.criteriaId).toBe("stability")
    expect(r.prompt).toBe("harden it")
  })

  it("rejects both unknown backends and collects both errors", () => {
    const r = parseAbArgs("--a=banana --b=grape test")
    expect(r.errors.length).toBe(2)
    expect(r.errors[0]).toMatch(/banana/)
    expect(r.errors[1]).toMatch(/grape/)
  })
})
