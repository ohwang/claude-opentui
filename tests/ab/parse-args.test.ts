/**
 * /ab argument parsing tests — purely string -> object, no orchestrator deps.
 */

import { describe, expect, it } from "bun:test"
import { parseAbArgs } from "../../src/commands/builtin/ab"

describe("parseAbArgs", () => {
  it("treats the entire input as a prompt when no flags are present", () => {
    const r = parseAbArgs("refactor the auth module please")
    expect(r.prompt).toBe("refactor the auth module please")
    expect(r.targetA).toBeUndefined()
    expect(r.targetB).toBeUndefined()
    expect(r.errors).toEqual([])
  })

  it("parses --a / --b shorthand", () => {
    const r = parseAbArgs("--a=claude --b=codex implement foo")
    expect(r.prompt).toBe("implement foo")
    expect(r.targetA).toEqual({ backendId: "claude", model: undefined })
    expect(r.targetB).toEqual({ backendId: "codex", model: undefined })
  })

  it("parses backend:model shorthand", () => {
    const r = parseAbArgs("--a=claude:opus --b=claude:sonnet do work")
    expect(r.targetA).toEqual({ backendId: "claude", model: "opus" })
    expect(r.targetB).toEqual({ backendId: "claude", model: "sonnet" })
  })

  it("parses --criteria=stability", () => {
    const r = parseAbArgs("--criteria=stability harden the parser")
    expect(r.criteriaId).toBe("stability")
    expect(r.prompt).toBe("harden the parser")
  })

  it("rejects unknown backends with a friendly error", () => {
    const r = parseAbArgs("--a=banana hello")
    expect(r.errors[0]).toMatch(/Unknown backend "banana"/)
    expect(r.targetA).toBeUndefined()
  })

  it("ignores quoted prompt segments correctly", () => {
    const r = parseAbArgs(`--a=mock --b=mock "say hello world"`)
    expect(r.prompt).toBe("say hello world")
  })

  it("allows flags to come after the prompt", () => {
    const r = parseAbArgs("hello world --a=mock --b=mock")
    expect(r.prompt).toBe("hello world")
    expect(r.targetA?.backendId).toBe("mock")
    expect(r.targetB?.backendId).toBe("mock")
  })

  it("returns empty prompt when only flags are supplied", () => {
    const r = parseAbArgs("--a=mock")
    expect(r.prompt).toBe("")
  })
})
