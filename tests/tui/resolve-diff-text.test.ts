import { describe, it, expect } from "bun:test"
import { resolveDiffText } from "../../src/frontends/tui/components/tool-view"

describe("resolveDiffText", () => {
  it("returns output as-is when it already looks like a unified diff (ACP case)", () => {
    const acpOutput = "--- a/foo.ts\n+++ b/foo.ts\n@@ -1,1 +1,1 @@\n-x\n+y"
    expect(resolveDiffText("Edit", { file_path: "foo.ts" }, acpOutput)).toBe(acpOutput)
  })

  it("synthesizes a diff from Claude Edit input (old_string / new_string)", () => {
    const diff = resolveDiffText(
      "Edit",
      { file_path: "foo.ts", old_string: "hello", new_string: "world" },
      "The file has been updated.",
    )
    expect(diff).toContain("--- a/foo.ts")
    expect(diff).toContain("-hello")
    expect(diff).toContain("+world")
  })

  it("synthesizes a creation diff from Write input (content only)", () => {
    const diff = resolveDiffText(
      "Write",
      { file_path: "new.ts", content: "line1\nline2" },
      "File created successfully.",
    )
    expect(diff).toContain("--- /dev/null")
    expect(diff).toContain("+++ b/new.ts")
    expect(diff).toContain("+line1")
    expect(diff).toContain("+line2")
  })

  it("synthesizes a MultiEdit diff by concatenating hunks", () => {
    const diff = resolveDiffText(
      "MultiEdit",
      {
        file_path: "foo.ts",
        edits: [
          { old_string: "a", new_string: "A" },
          { old_string: "b", new_string: "B" },
        ],
      },
      "",
    )
    expect(diff).toContain("-a")
    expect(diff).toContain("+A")
    expect(diff).toContain("-b")
    expect(diff).toContain("+B")
  })

  it("returns undefined for non-edit tools", () => {
    expect(resolveDiffText("Read", { file_path: "foo.ts" }, "file contents")).toBeUndefined()
    expect(resolveDiffText("Bash", { command: "ls" }, "total 0")).toBeUndefined()
  })

  it("returns undefined when Edit input is missing old_string/new_string", () => {
    expect(resolveDiffText("Edit", { file_path: "foo.ts" }, "")).toBeUndefined()
  })

  it("returns undefined when no file_path is available", () => {
    expect(resolveDiffText("Edit", { old_string: "a", new_string: "b" }, "")).toBeUndefined()
  })

  it("prefers existing unified-diff output over synthesis", () => {
    // Even with Edit input, if output is already a diff, return that verbatim.
    const existing = "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new"
    const result = resolveDiffText(
      "Edit",
      { file_path: "y.ts", old_string: "different", new_string: "stuff" },
      existing,
    )
    expect(result).toBe(existing)
  })
})
