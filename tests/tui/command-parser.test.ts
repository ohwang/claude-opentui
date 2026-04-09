import { describe, expect, it } from "bun:test"
import { parseCommandString } from "../../src/tui/components/command-parser"

describe("parseCommandString", () => {
  describe("basic parsing", () => {
    it("splits simple space-separated args", () => {
      expect(parseCommandString("ls -la /tmp")).toEqual(["ls", "-la", "/tmp"])
    })

    it("handles single word", () => {
      expect(parseCommandString("vim")).toEqual(["vim"])
    })

    it("returns empty array for empty string", () => {
      expect(parseCommandString("")).toEqual([])
    })

    it("returns empty array for whitespace-only string", () => {
      expect(parseCommandString("   ")).toEqual([])
      expect(parseCommandString("\t\n")).toEqual([])
    })

    it("trims leading and trailing whitespace", () => {
      expect(parseCommandString("  git status  ")).toEqual(["git", "status"])
    })

    it("collapses multiple spaces between args", () => {
      expect(parseCommandString("git   status    --short")).toEqual([
        "git",
        "status",
        "--short",
      ])
    })
  })

  describe("double-quoted strings", () => {
    it("preserves spaces inside double quotes", () => {
      expect(parseCommandString('echo "hello world"')).toEqual([
        "echo",
        "hello world",
      ])
    })

    it("handles double-quoted arg with path spaces", () => {
      expect(
        parseCommandString('open -a "Visual Studio Code" --wait-apps'),
      ).toEqual(["open", "-a", "Visual Studio Code", "--wait-apps"])
    })

    it("handles adjacent text and quotes", () => {
      expect(parseCommandString('prefix"quoted"suffix')).toEqual([
        "prefixquotedsuffix",
      ])
    })

    it("handles empty double quotes (no empty arg produced)", () => {
      // The parser's `if (current)` check filters out empty strings
      expect(parseCommandString('echo ""')).toEqual(["echo"])
    })
  })

  describe("single-quoted strings", () => {
    it("preserves spaces inside single quotes", () => {
      expect(parseCommandString("echo 'hello world'")).toEqual([
        "echo",
        "hello world",
      ])
    })

    it("preserves backslashes inside single quotes (no escape processing)", () => {
      // In shell, single quotes preserve everything literally
      expect(parseCommandString("echo 'path\\to\\file'")).toEqual([
        "echo",
        "path\\to\\file",
      ])
    })

    it("handles empty single quotes (no empty arg produced)", () => {
      // Same as double quotes — empty string is not pushed
      expect(parseCommandString("echo ''")).toEqual(["echo"])
    })
  })

  describe("mixed quotes", () => {
    it("handles double quotes inside single quotes", () => {
      expect(parseCommandString(`echo '"hello"'`)).toEqual([
        "echo",
        '"hello"',
      ])
    })

    it("handles single quotes inside double quotes", () => {
      expect(parseCommandString(`echo "it's fine"`)).toEqual([
        "echo",
        "it's fine",
      ])
    })
  })

  describe("escape sequences", () => {
    it("handles backslash-escaped spaces", () => {
      expect(parseCommandString("path/to\\ file")).toEqual(["path/to file"])
    })

    it("handles backslash-escaped quotes", () => {
      expect(parseCommandString('echo \\"hello\\"')).toEqual([
        "echo",
        '"hello"',
      ])
    })

    it("handles trailing backslash", () => {
      // Trailing backslash with nothing to escape — should be preserved
      expect(parseCommandString("echo test\\")).toEqual(["echo", "test\\"])
    })

    it("escapes are not processed inside single quotes", () => {
      expect(parseCommandString("echo '\\n'")).toEqual(["echo", "\\n"])
    })

    it("escapes are processed inside double quotes", () => {
      // Backslash inside double quotes escapes the next character
      expect(parseCommandString('echo "hello\\"world"')).toEqual([
        "echo",
        'hello"world',
      ])
    })
  })

  describe("real-world editor commands", () => {
    it("parses VS Code path with spaces", () => {
      expect(
        parseCommandString(
          "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code --wait",
        ),
      ).toEqual([
        "/Applications/Visual",
        "Studio",
        "Code.app/Contents/Resources/app/bin/code",
        "--wait",
      ])
      // Note: without quoting, spaces split the path. That's correct behavior.
      // Users should quote: '"/Applications/Visual Studio Code.app/.../code" --wait'
    })

    it("parses quoted VS Code path correctly", () => {
      expect(
        parseCommandString(
          '"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --wait',
        ),
      ).toEqual([
        "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
        "--wait",
      ])
    })

    it("parses vim with flags", () => {
      expect(parseCommandString("vim -u NONE -c 'set noswap'")).toEqual([
        "vim",
        "-u",
        "NONE",
        "-c",
        "set noswap",
      ])
    })

    it("parses nano with line number", () => {
      expect(parseCommandString("nano +10 /tmp/test.txt")).toEqual([
        "nano",
        "+10",
        "/tmp/test.txt",
      ])
    })

    it("parses emacs in terminal mode", () => {
      expect(parseCommandString("emacs -nw")).toEqual(["emacs", "-nw"])
    })

    it("parses complex command with mixed quoting", () => {
      expect(
        parseCommandString(`sh -c "echo 'hello world' > /tmp/out.txt"`),
      ).toEqual(["sh", "-c", "echo 'hello world' > /tmp/out.txt"])
    })
  })
})
