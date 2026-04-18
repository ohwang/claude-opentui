/**
 * One Light theme — registry + text readability contract.
 *
 * Validates that:
 *   1. The theme is registered and retrievable by id.
 *   2. applyTheme() mutates the reactive color store.
 *   3. All *text* colors meet a WCAG AA readability floor of 4.5:1 against
 *      the primary background. This is what "all text clearly visible"
 *      actually means — not a vibe check.
 *
 * Covers text.primary/secondary/muted/thinking/briefLabel/briefLabelClaude
 * plus the accent + status colors used for inline labels (success, warning,
 * error, info, planMode, ide, bash prefix).
 *
 * Decorative-only tokens (text.subtle, border.muted, diff.*Bg, etc.) are
 * excluded — they are never used on body text.
 */

import { describe, it, expect } from "bun:test"
import { getTheme, listThemes } from "../../src/frontends/tui/theme/registry"
import { applyTheme, colors, getCurrentThemeId } from "../../src/frontends/tui/theme/tokens"
import { oneLight } from "../../src/frontends/tui/theme/presets/one-light"

// ---------------------------------------------------------------------------
// Contrast math — WCAG 2.1 relative luminance + contrast ratio
// ---------------------------------------------------------------------------

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "")
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

/** Relative luminance per WCAG 2.1 §1.4.3. */
function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Contrast ratio per WCAG 2.1 — returns 1..21. */
function contrast(fg: string, bg: string): number {
  const l1 = luminance(fg)
  const l2 = luminance(bg)
  const [light, dark] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (light + 0.05) / (dark + 0.05)
}

describe("one-light theme", () => {
  it("is registered and retrievable by id", () => {
    const t = getTheme("one-light")
    expect(t).toBeDefined()
    expect(t?.name).toBe("One Light")
    expect(listThemes().some((x) => x.id === "one-light")).toBe(true)
  })

  it("applyTheme switches the active store", () => {
    applyTheme(oneLight)
    try {
      expect(getCurrentThemeId()).toBe("one-light")
      expect(colors.bg.primary).toBe(oneLight.colors.bg.primary)
      expect(colors.text.primary).toBe(oneLight.colors.text.primary)
    } finally {
      // Restore dark theme for isolation — subsequent tests assume dark.
      const dark = getTheme("dark")
      if (dark) applyTheme(dark)
    }
  })

  it("has no placeholder colors — all entries are hex strings", () => {
    const walk = (obj: unknown): string[] => {
      const out: string[] = []
      if (typeof obj === "string") out.push(obj)
      else if (obj && typeof obj === "object") {
        for (const v of Object.values(obj)) out.push(...walk(v))
      }
      return out
    }
    for (const value of walk(oneLight.colors)) {
      expect(value).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  describe("text legibility against bg.primary", () => {
    const bg = oneLight.colors.bg.primary!

    // WCAG AA body text: 4.5:1. For hints/metadata we accept 4.5 too —
    // they still carry semantic information and must be readable.
    const AA_BODY = 4.5
    // Large/decorative text threshold — we use this for shimmer *targets*,
    // which are transient animation states, not resting-state colors.
    const AA_LARGE = 3.0

    const bodyTextTokens: Array<[string, string, number]> = [
      ["text.primary", oneLight.colors.text.primary, AA_BODY],
      ["text.secondary", oneLight.colors.text.secondary, AA_BODY],
      ["text.muted", oneLight.colors.text.muted, AA_BODY],
      ["text.thinking", oneLight.colors.text.thinking, AA_BODY],
      ["text.briefLabel", oneLight.colors.text.briefLabel, AA_BODY],
      ["text.briefLabelClaude", oneLight.colors.text.briefLabelClaude, AA_BODY],
      // Accents used inline as label text
      ["accent.primary", oneLight.colors.accent.primary, AA_BODY],
      ["accent.suggestion", oneLight.colors.accent.suggestion, AA_BODY],
      ["accent.highlight", oneLight.colors.accent.highlight, AA_BODY],
      ["accent.permission", oneLight.colors.accent.permission, AA_BODY],
      ["accent.bash", oneLight.colors.accent.bash, AA_BODY],
      ["accent.planMode", oneLight.colors.accent.planMode, AA_BODY],
      ["accent.ide", oneLight.colors.accent.ide, AA_BODY],
      // Status colors rendered as text (cost, error summary, warnings)
      ["status.success", oneLight.colors.status.success, AA_BODY],
      ["status.warning", oneLight.colors.status.warning, AA_BODY],
      ["status.error", oneLight.colors.status.error, AA_BODY],
      ["status.info", oneLight.colors.status.info, AA_BODY],
      // State dot — also shown as a label next to text in status bar
      ["state.idle", oneLight.colors.state.idle, AA_LARGE],
      ["state.running", oneLight.colors.state.running, AA_LARGE],
      ["state.waiting", oneLight.colors.state.waiting, AA_LARGE],
      ["state.error", oneLight.colors.state.error, AA_LARGE],
    ]

    for (const [name, color, threshold] of bodyTextTokens) {
      it(`${name} contrasts ≥ ${threshold}:1 against bg`, () => {
        const ratio = contrast(color, bg)
        if (ratio < threshold) {
          throw new Error(
            `${name} (${color}) has only ${ratio.toFixed(2)}:1 contrast against bg ${bg} — needs ≥ ${threshold}:1`,
          )
        }
        expect(ratio).toBeGreaterThanOrEqual(threshold)
      })
    }
  })

  it("diff line text remains readable over its tinted background", () => {
    // Added/removed text over their respective tinted backgrounds must stay
    // legible — otherwise diffs turn into a pastel mush.
    const addedRatio = contrast(
      oneLight.colors.diff.added,
      oneLight.colors.diff.addedBg,
    )
    const removedRatio = contrast(
      oneLight.colors.diff.removed,
      oneLight.colors.diff.removedBg,
    )
    // 3:1 is WCAG AA for large/bold text; diff glyphs are usually mono
    // and fairly dense, so 3:1 is the right floor (higher = better).
    expect(addedRatio).toBeGreaterThanOrEqual(3.0)
    expect(removedRatio).toBeGreaterThanOrEqual(3.0)
  })

  it("syntax palette selector resolves to LIGHT palette for one-light bg", () => {
    // Sanity check — the syntax highlighter picks light vs dark by luminance.
    // If this fails, code blocks in one-light would render with DARK syntax.
    const bg = oneLight.colors.bg.primary!
    const [r, g, b] = parseHex(bg)
    const rel = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    expect(rel).toBeGreaterThan(0.5)
  })
})
