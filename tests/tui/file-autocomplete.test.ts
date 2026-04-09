import { describe, expect, it } from "bun:test"
import { homedir } from "os"
import { resolve } from "path"
import { parsePathPrefix, findLongestCommonPrefix } from "../../src/tui/components/file-autocomplete"

const CWD = "/Users/test/project"

describe("parsePathPrefix", () => {
  describe("no prefix (default to cwd)", () => {
    it("returns cwd for empty query", () => {
      const result = parsePathPrefix("", CWD)
      expect(result).toEqual({ root: CWD, fuzzyQuery: "", prefix: "" })
    })

    it("returns cwd for simple filename query", () => {
      const result = parsePathPrefix("comp", CWD)
      expect(result).toEqual({ root: CWD, fuzzyQuery: "comp", prefix: "" })
    })

    it("treats path-like queries without special prefix as full fuzzy query", () => {
      const result = parsePathPrefix("src/comp", CWD)
      expect(result).toEqual({ root: CWD, fuzzyQuery: "src/comp", prefix: "" })
    })
  })

  describe("~/ prefix (home directory)", () => {
    it("resolves ~/ to home directory", () => {
      const result = parsePathPrefix("~/", CWD)
      expect(result).toEqual({ root: homedir(), fuzzyQuery: "", prefix: "~/" })
    })

    it("resolves ~/foo as fuzzy query under home", () => {
      const result = parsePathPrefix("~/foo", CWD)
      expect(result).toEqual({ root: homedir(), fuzzyQuery: "foo", prefix: "~/" })
    })

    it("resolves ~/dev/ to home/dev with empty fuzzy query", () => {
      const result = parsePathPrefix("~/dev/", CWD)
      expect(result).toEqual({
        root: resolve(homedir(), "dev"),
        fuzzyQuery: "",
        prefix: "~/dev/",
      })
    })

    it("resolves ~/dev/re to home/dev with fuzzy query 're'", () => {
      const result = parsePathPrefix("~/dev/re", CWD)
      expect(result).toEqual({
        root: resolve(homedir(), "dev"),
        fuzzyQuery: "re",
        prefix: "~/dev/",
      })
    })

    it("resolves nested ~/a/b/c to correct root and query", () => {
      const result = parsePathPrefix("~/a/b/c", CWD)
      expect(result).toEqual({
        root: resolve(homedir(), "a/b"),
        fuzzyQuery: "c",
        prefix: "~/a/b/",
      })
    })
  })

  describe("../ prefix (relative parent)", () => {
    it("resolves ../ to parent directory", () => {
      const result = parsePathPrefix("../", CWD)
      expect(result).toEqual({
        root: resolve(CWD, ".."),
        fuzzyQuery: "",
        prefix: "../",
      })
    })

    it("resolves ../foo as fuzzy query in parent", () => {
      const result = parsePathPrefix("../foo", CWD)
      expect(result).toEqual({
        root: resolve(CWD, ".."),
        fuzzyQuery: "foo",
        prefix: "../",
      })
    })

    it("resolves ../src/comp to parent/src with fuzzy query", () => {
      const result = parsePathPrefix("../src/comp", CWD)
      expect(result).toEqual({
        root: resolve(CWD, "../src"),
        fuzzyQuery: "comp",
        prefix: "../src/",
      })
    })

    it("resolves ../../ to grandparent", () => {
      const result = parsePathPrefix("../../", CWD)
      expect(result).toEqual({
        root: resolve(CWD, "../.."),
        fuzzyQuery: "",
        prefix: "../../",
      })
    })

    it("resolves ../../other/bar to grandparent/other with query", () => {
      const result = parsePathPrefix("../../other/bar", CWD)
      expect(result).toEqual({
        root: resolve(CWD, "../../other"),
        fuzzyQuery: "bar",
        prefix: "../../other/",
      })
    })
  })

  describe("/ prefix (absolute path)", () => {
    it("resolves / to filesystem root", () => {
      const result = parsePathPrefix("/", CWD)
      expect(result).toEqual({ root: "/", fuzzyQuery: "", prefix: "/" })
    })

    it("resolves /usr/ to /usr with empty query", () => {
      const result = parsePathPrefix("/usr/", CWD)
      expect(result).toEqual({ root: "/usr", fuzzyQuery: "", prefix: "/usr/" })
    })

    it("resolves /usr/local/bin/rg to /usr/local/bin with query 'rg'", () => {
      const result = parsePathPrefix("/usr/local/bin/rg", CWD)
      expect(result).toEqual({
        root: "/usr/local/bin",
        fuzzyQuery: "rg",
        prefix: "/usr/local/bin/",
      })
    })
  })
})

describe("findLongestCommonPrefix", () => {
  it("returns empty for empty array", () => {
    expect(findLongestCommonPrefix([])).toBe("")
  })

  it("returns the single item for single-element array", () => {
    expect(findLongestCommonPrefix(["abc"])).toBe("abc")
  })

  it("finds common prefix for path-like strings", () => {
    expect(findLongestCommonPrefix(["src/foo.ts", "src/bar.ts"])).toBe("src/")
  })

  it("returns empty when no common prefix", () => {
    expect(findLongestCommonPrefix(["abc", "xyz"])).toBe("")
  })

  it("handles fully identical strings", () => {
    expect(findLongestCommonPrefix(["same", "same", "same"])).toBe("same")
  })

  it("finds common prefix across many items", () => {
    expect(
      findLongestCommonPrefix([
        "components/input.tsx",
        "components/button.tsx",
        "components/dialog.tsx",
      ]),
    ).toBe("components/")
  })
})
