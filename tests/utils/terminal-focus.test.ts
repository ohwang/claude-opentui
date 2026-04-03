import { describe, expect, it, beforeEach } from "bun:test"
import {
  onFocusChange,
  isFocused,
  _resetForTest,
  _simulateFocusData,
} from "../../src/utils/terminal-focus"

describe("terminal-focus", () => {
  beforeEach(() => {
    _resetForTest()
  })

  // ── Focus state tracking ──────────────────────────────────────────────

  it("starts with null focus state", () => {
    expect(isFocused()).toBeNull()
  })

  it("sets focused=true on ESC [ I sequence", () => {
    _simulateFocusData("\x1b[I")
    expect(isFocused()).toBe(true)
  })

  it("sets focused=false on ESC [ O sequence", () => {
    _simulateFocusData("\x1b[O")
    expect(isFocused()).toBe(false)
  })

  it("tracks focus/blur transitions", () => {
    _simulateFocusData("\x1b[I")
    expect(isFocused()).toBe(true)

    _simulateFocusData("\x1b[O")
    expect(isFocused()).toBe(false)

    _simulateFocusData("\x1b[I")
    expect(isFocused()).toBe(true)
  })

  // ── Listener callbacks ────────────────────────────────────────────────

  it("notifies listeners on focus gained", () => {
    const events: boolean[] = []
    onFocusChange((focused) => events.push(focused))

    _simulateFocusData("\x1b[I")
    expect(events).toEqual([true])
  })

  it("notifies listeners on focus lost", () => {
    const events: boolean[] = []
    onFocusChange((focused) => events.push(focused))

    _simulateFocusData("\x1b[O")
    expect(events).toEqual([false])
  })

  it("notifies multiple listeners", () => {
    const a: boolean[] = []
    const b: boolean[] = []
    onFocusChange((f) => a.push(f))
    onFocusChange((f) => b.push(f))

    _simulateFocusData("\x1b[I")
    expect(a).toEqual([true])
    expect(b).toEqual([true])
  })

  it("unsubscribes a listener when cleanup is called", () => {
    const events: boolean[] = []
    const unsub = onFocusChange((f) => events.push(f))

    _simulateFocusData("\x1b[I")
    expect(events).toEqual([true])

    unsub()

    _simulateFocusData("\x1b[O")
    // Should still be [true] — no new event after unsubscribe
    expect(events).toEqual([true])
  })

  // ── Data parsing edge cases ───────────────────────────────────────────

  it("ignores data that doesn't contain focus sequences", () => {
    const events: boolean[] = []
    onFocusChange((f) => events.push(f))

    _simulateFocusData("hello world")
    _simulateFocusData("\x1b[1;2H") // cursor move, not focus
    expect(events).toEqual([])
    expect(isFocused()).toBeNull()
  })

  it("detects focus sequence embedded in other data", () => {
    const events: boolean[] = []
    onFocusChange((f) => events.push(f))

    _simulateFocusData("some prefix\x1b[Isome suffix")
    expect(events).toEqual([true])
  })
})
