import { describe, expect, it } from "bun:test"
import {
  truncatePathMiddle,
  truncateToWidth,
  truncateStartToWidth,
  truncateToWidthNoEllipsis,
  truncate,
  wrapText,
  stringWidth,
} from "../../src/utils/truncate"

describe("stringWidth", () => {
  it("returns character count for plain strings", () => {
    expect(stringWidth("hello")).toBe(5)
    expect(stringWidth("")).toBe(0)
  })

  it("strips ANSI escape codes", () => {
    expect(stringWidth("\x1b[31mred\x1b[0m")).toBe(3)
    expect(stringWidth("\x1b[1;34mbold blue\x1b[0m")).toBe(9)
  })
})

describe("truncateToWidth", () => {
  it("returns text as-is when within limit", () => {
    expect(truncateToWidth("short", 10)).toBe("short")
  })

  it("truncates with ellipsis when too long", () => {
    expect(truncateToWidth("hello world", 8)).toBe("hello w\u2026")
  })

  it("handles maxWidth of 1", () => {
    expect(truncateToWidth("hello", 1)).toBe("\u2026")
  })

  it("handles maxWidth of 0", () => {
    expect(truncateToWidth("hello", 0)).toBe("")
  })

  it("returns empty for negative maxWidth", () => {
    expect(truncateToWidth("hello", -5)).toBe("")
  })
})

describe("truncateStartToWidth", () => {
  it("returns text as-is when within limit", () => {
    expect(truncateStartToWidth("short", 10)).toBe("short")
  })

  it("truncates from start with ellipsis", () => {
    expect(truncateStartToWidth("hello world", 8)).toBe("\u2026o world")
  })

  it("handles maxWidth of 1", () => {
    expect(truncateStartToWidth("hello", 1)).toBe("\u2026")
  })

  it("handles maxWidth of 0", () => {
    expect(truncateStartToWidth("hello", 0)).toBe("")
  })
})

describe("truncateToWidthNoEllipsis", () => {
  it("returns text as-is when within limit", () => {
    expect(truncateToWidthNoEllipsis("short", 10)).toBe("short")
  })

  it("truncates without ellipsis", () => {
    expect(truncateToWidthNoEllipsis("hello world", 5)).toBe("hello")
  })

  it("handles maxWidth of 0", () => {
    expect(truncateToWidthNoEllipsis("hello", 0)).toBe("")
  })
})

describe("truncatePathMiddle", () => {
  it("returns short path as-is", () => {
    expect(truncatePathMiddle("src/file.ts", 30)).toBe("src/file.ts")
  })

  it("truncates long path in the middle", () => {
    const path = "src/components/deeply/nested/folder/MyComponent.tsx"
    const result = truncatePathMiddle(path, 35)
    // Should preserve start of dir and the filename
    expect(result).toContain("src/")
    expect(result).toContain("MyComponent.tsx")
    expect(result).toContain("\u2026")
    expect(stringWidth(result)).toBeLessThanOrEqual(35)
  })

  it("handles filename-only paths", () => {
    expect(truncatePathMiddle("MyComponent.tsx", 10)).toBe("\u2026onent.tsx")
    expect(stringWidth(truncatePathMiddle("MyComponent.tsx", 10))).toBeLessThanOrEqual(10)
  })

  it("handles paths with no directory component", () => {
    expect(truncatePathMiddle("file.ts", 30)).toBe("file.ts")
  })

  it("returns empty for maxWidth 0", () => {
    expect(truncatePathMiddle("src/file.ts", 0)).toBe("")
  })

  it("handles very small maxWidth", () => {
    const result = truncatePathMiddle("src/components/file.ts", 3)
    expect(stringWidth(result)).toBeLessThanOrEqual(3)
  })

  it("returns path as-is when exactly at maxWidth", () => {
    const path = "src/file.ts"
    expect(truncatePathMiddle(path, path.length)).toBe(path)
  })

  it("handles deeply nested paths", () => {
    const path = "a/b/c/d/e/f/g/h/i/j/file.ts"
    const result = truncatePathMiddle(path, 20)
    expect(result).toContain("file.ts")
    expect(result).toContain("\u2026")
    expect(stringWidth(result)).toBeLessThanOrEqual(20)
  })

  it("handles paths where filename is almost the full budget", () => {
    const path = "dir/VeryLongComponentFileName.tsx"
    const result = truncatePathMiddle(path, 30)
    expect(result).toContain("VeryLongComponentFileName.tsx")
    expect(stringWidth(result)).toBeLessThanOrEqual(30)
  })
})

describe("truncate", () => {
  it("truncates at the end", () => {
    expect(truncate("hello world", 8)).toBe("hello w\u2026")
  })

  it("collapses newlines in singleLine mode", () => {
    expect(truncate("hello\nworld", 20, true)).toBe("hello world")
  })

  it("collapses newlines and truncates in singleLine mode", () => {
    expect(truncate("hello\nworld\nfoo", 10, true)).toBe("hello wor\u2026")
  })
})

describe("wrapText", () => {
  it("returns single line when text fits", () => {
    expect(wrapText("hello", 10)).toEqual(["hello"])
  })

  it("wraps on word boundaries", () => {
    const lines = wrapText("hello world foo", 11)
    expect(lines[0]).toBe("hello world")
    expect(lines[1]).toBe("foo")
  })

  it("preserves explicit newlines", () => {
    const lines = wrapText("line1\nline2", 20)
    expect(lines).toEqual(["line1", "line2"])
  })

  it("hard-breaks long words", () => {
    const lines = wrapText("abcdefghij", 5)
    expect(lines).toEqual(["abcde", "fghij"])
  })

  it("returns empty array for width 0", () => {
    expect(wrapText("hello", 0)).toEqual([])
  })

  it("handles empty string", () => {
    expect(wrapText("", 10)).toEqual([""])
  })
})
