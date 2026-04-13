import { describe, it, expect } from "bun:test"
import { buildUnifiedDiff, looksLikeUnifiedDiff } from "../../src/utils/format-diff"

describe("buildUnifiedDiff", () => {
  it("produces valid unified-diff markers for simple edits", () => {
    const d = buildUnifiedDiff({ path: "foo.ts", oldText: "hello", newText: "world" })
    expect(d).toContain("--- a/foo.ts")
    expect(d).toContain("+++ b/foo.ts")
    expect(d).toContain("@@ -1,1 +1,1 @@")
    expect(d).toContain("-hello")
    expect(d).toContain("+world")
    expect(looksLikeUnifiedDiff(d)).toBe(true)
  })

  it("uses /dev/null for file creation (empty oldText)", () => {
    const d = buildUnifiedDiff({ path: "new.ts", oldText: "", newText: "a\nb" })
    expect(d).toContain("--- /dev/null")
    expect(d).toContain("+++ b/new.ts")
    expect(d).toContain("@@ -0,0 +1,2 @@")
    expect(d).toContain("+a")
    expect(d).toContain("+b")
    // No removed-content lines (only the "--- " header starts with a dash)
    const contentLines = d.split("\n").filter(l => !l.startsWith("---"))
    expect(contentLines.some(l => l.startsWith("-"))).toBe(false)
  })

  it("uses /dev/null for file deletion (empty newText)", () => {
    const d = buildUnifiedDiff({ path: "dead.ts", oldText: "x", newText: "" })
    expect(d).toContain("--- a/dead.ts")
    expect(d).toContain("+++ /dev/null")
    expect(d).toContain("@@ -1,1 +0,0 @@")
    expect(d).toContain("-x")
  })

  it("handles multi-line text", () => {
    const d = buildUnifiedDiff({
      path: "a.ts",
      oldText: "one\ntwo\nthree",
      newText: "one\nTWO\nthree",
    })
    expect(d).toContain("@@ -1,3 +1,3 @@")
    const lines = d.split("\n")
    expect(lines.filter(l => l.startsWith("-")).length).toBe(4) // 3 removed + header
    expect(lines.filter(l => l.startsWith("+")).length).toBe(4) // 3 added + header
  })

  it("output is recognized by looksLikeUnifiedDiff", () => {
    expect(looksLikeUnifiedDiff(buildUnifiedDiff({ path: "p", oldText: "a", newText: "b" }))).toBe(true)
  })
})

describe("looksLikeUnifiedDiff", () => {
  it("returns true for text with all three markers", () => {
    expect(looksLikeUnifiedDiff("--- a/x\n+++ b/x\n@@ -1 +1 @@")).toBe(true)
  })

  it("returns false when any marker is missing", () => {
    expect(looksLikeUnifiedDiff("--- a/x\n+++ b/x")).toBe(false)
    expect(looksLikeUnifiedDiff("--- a/x\n@@ -1 +1 @@")).toBe(false)
    expect(looksLikeUnifiedDiff("+++ b/x\n@@ -1 +1 @@")).toBe(false)
  })

  it("returns false for plain tool success messages", () => {
    expect(looksLikeUnifiedDiff("The file has been updated successfully.")).toBe(false)
  })
})
