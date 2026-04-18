import { describe, expect, it } from "bun:test"
import { isSubmitKey } from "../../src/frontends/tui/components/input-area"

describe("isSubmitKey", () => {
  it("submits on plain Enter", () => {
    expect(isSubmitKey({ name: "return", shift: false, meta: false, super: false })).toBe(true)
  })

  it("does not submit on Shift+Enter", () => {
    expect(isSubmitKey({ name: "return", shift: true, meta: false, super: false })).toBe(false)
  })

  it("does not submit on Cmd+Enter when terminals report it as meta", () => {
    expect(isSubmitKey({ name: "return", shift: false, meta: true, super: false })).toBe(false)
  })

  it("does not submit on Cmd+Enter when terminals report it as super", () => {
    expect(isSubmitKey({ name: "return", shift: false, meta: false, super: true })).toBe(false)
  })
})
