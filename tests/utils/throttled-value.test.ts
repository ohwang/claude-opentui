import { describe, expect, it } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createThrottledValue } from "../../src/utils/throttled-value"

/**
 * createThrottledValue relies on SolidJS createEffect for reactivity.
 * Tests run without --conditions=browser, so SolidJS uses the SSR build
 * where effects fire once during creation but don't re-run on signal changes.
 *
 * We verify: initial value, type generics, and null handling.
 * Reactive coalescing (the core feature) is verified via manual smoke test
 * with `bun run dev`. The throttle logic itself is a standard leading-edge
 * throttle pattern — same as OpenCode's createThrottledValue.
 */

describe("createThrottledValue", () => {
  it("returns the initial value immediately (string)", () => {
    createRoot((dispose) => {
      const [source] = createSignal("hello")
      const throttled = createThrottledValue(source)
      expect(throttled()).toBe("hello")
      dispose()
    })
  })

  it("returns the initial value immediately (number)", () => {
    createRoot((dispose) => {
      const [source] = createSignal(42)
      const throttled = createThrottledValue(source, 100)
      expect(throttled()).toBe(42)
      dispose()
    })
  })

  it("returns the initial value immediately (null)", () => {
    createRoot((dispose) => {
      const [source] = createSignal<string | null>(null)
      const throttled = createThrottledValue(source, 100)
      expect(throttled()).toBe(null)
      dispose()
    })
  })

  it("returns the initial value immediately (object)", () => {
    createRoot((dispose) => {
      const obj = { status: "running" as const }
      const [source] = createSignal(obj)
      const throttled = createThrottledValue(source)
      expect(throttled()).toBe(obj)
      dispose()
    })
  })

  it("accepts a custom interval parameter", () => {
    createRoot((dispose) => {
      const [source] = createSignal("test")
      // Should not throw with custom interval
      const throttled = createThrottledValue(source, 200)
      expect(throttled()).toBe("test")
      dispose()
    })
  })

  it("cleanup does not throw when disposed immediately", () => {
    // Ensure onCleanup timer cancellation is safe even with no pending timers
    expect(() => {
      createRoot((dispose) => {
        const [source] = createSignal("x")
        createThrottledValue(source, 50)
        dispose()
      })
    }).not.toThrow()
  })
})
