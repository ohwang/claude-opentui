/**
 * Status bar preset registry — contract tests.
 *
 * Validates:
 *   1. The three built-in presets (`default`, `minimal`, `detailed`) are
 *      registered and retrievable by id.
 *   2. `resolveStatusBar()` returns an exact match when one exists, and
 *      soft-falls back to `default` for unknown ids (never throws, never
 *      returns undefined).
 *   3. `applyStatusBar()` updates the reactive signal and flags the fallback
 *      case so callers can surface a warning.
 *   4. Built-in presets all declare required fields (id, name, description,
 *      render) so no preset can sneak in missing metadata.
 */

import { describe, it, expect, beforeEach } from "bun:test"
import {
  DEFAULT_STATUS_BAR_ID,
  getStatusBar,
  listStatusBars,
  resolveStatusBar,
} from "../../src/tui/status-bar/registry"
import {
  applyStatusBar,
  getCurrentStatusBarId,
  hasStatusBar,
} from "../../src/tui/status-bar/active"

describe("status bar registry — built-in presets", () => {
  it("registers default, minimal, detailed, and claude-compat", () => {
    const ids = listStatusBars().map(p => p.id).sort()
    expect(ids).toContain("default")
    expect(ids).toContain("minimal")
    expect(ids).toContain("detailed")
    expect(ids).toContain("claude-compat")
  })

  it("claude-compat is the DEFAULT_STATUS_BAR_ID", () => {
    expect(DEFAULT_STATUS_BAR_ID).toBe("claude-compat")
    expect(getStatusBar(DEFAULT_STATUS_BAR_ID)).toBeDefined()
  })

  it("every built-in preset declares id, name, description, and render", () => {
    for (const preset of listStatusBars()) {
      expect(typeof preset.id).toBe("string")
      expect(preset.id.length).toBeGreaterThan(0)
      expect(typeof preset.name).toBe("string")
      expect(preset.name.length).toBeGreaterThan(0)
      expect(typeof preset.description).toBe("string")
      expect(preset.description.length).toBeGreaterThan(0)
      expect(typeof preset.render).toBe("function")
    }
  })
})

describe("resolveStatusBar — soft-fail semantics", () => {
  it("returns the exact match when one exists", () => {
    const { preset, fellBack } = resolveStatusBar("minimal")
    expect(preset.id).toBe("minimal")
    expect(fellBack).toBe(false)
  })

  it("falls back to default when id is undefined", () => {
    const { preset, fellBack, requestedId } = resolveStatusBar(undefined)
    expect(preset.id).toBe(DEFAULT_STATUS_BAR_ID)
    expect(fellBack).toBe(false) // no id == no fallback, just the default
    expect(requestedId).toBeUndefined()
  })

  it("falls back to default for unknown ids and flags the requested id", () => {
    const { preset, fellBack, requestedId } = resolveStatusBar("nope-does-not-exist")
    expect(preset.id).toBe(DEFAULT_STATUS_BAR_ID)
    expect(fellBack).toBe(true)
    expect(requestedId).toBe("nope-does-not-exist")
  })

  it("falls back on empty string id too", () => {
    // An explicit empty string is a typo or bad config — same behavior as undefined
    const { preset } = resolveStatusBar("")
    expect(preset.id).toBe(DEFAULT_STATUS_BAR_ID)
  })
})

describe("applyStatusBar — reactive signal updates", () => {
  beforeEach(() => {
    // Reset to default between tests so ordering doesn't leak state
    applyStatusBar(DEFAULT_STATUS_BAR_ID)
  })

  it("switches the active id for known presets", () => {
    expect(getCurrentStatusBarId()).toBe("claude-compat")
    const result = applyStatusBar("minimal")
    expect(result.fellBack).toBe(false)
    expect(result.id).toBe("minimal")
    expect(getCurrentStatusBarId()).toBe("minimal")
  })

  it("soft-fails to default when switching to an unknown id", () => {
    const result = applyStatusBar("not-a-real-preset")
    expect(result.fellBack).toBe(true)
    expect(result.requestedId).toBe("not-a-real-preset")
    expect(result.id).toBe(DEFAULT_STATUS_BAR_ID)
    expect(getCurrentStatusBarId()).toBe(DEFAULT_STATUS_BAR_ID)
  })

  it("hasStatusBar agrees with getStatusBar", () => {
    expect(hasStatusBar("default")).toBe(true)
    expect(hasStatusBar("minimal")).toBe(true)
    expect(hasStatusBar("detailed")).toBe(true)
    expect(hasStatusBar("nope")).toBe(false)
  })
})
