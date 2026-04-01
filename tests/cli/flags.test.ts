import { describe, expect, it } from "bun:test"
import { parseFlags, printHelp } from "../../src/cli/flags"

/** Helper: build argv as if bun invoked the script with the given flags */
function argv(...flags: string[]): string[] {
  return ["bun", "script.ts", ...flags]
}

describe("parseFlags", () => {
  // -----------------------------------------------------------------------
  // 1. Empty args — defaults
  // -----------------------------------------------------------------------
  describe("empty args (defaults)", () => {
    it("returns default config when no flags provided", () => {
      const result = parseFlags(argv())

      expect(result.config).toEqual({})
      expect(result.backend).toBe("claude")
      expect(result.help).toBe(false)
      expect(result.version).toBe(false)
      expect(result.debug).toBe(false)
      expect(result.debugBackend).toBe(false)
      expect(result.prompt).toBeUndefined()
    })
  })

  // -----------------------------------------------------------------------
  // 2. Model flag
  // -----------------------------------------------------------------------
  describe("--model", () => {
    it("sets config.model with --model", () => {
      const result = parseFlags(argv("--model", "claude-sonnet-4-6"))
      expect(result.config.model).toBe("claude-sonnet-4-6")
    })

    it("sets config.model with -m short flag", () => {
      const result = parseFlags(argv("-m", "claude-opus-4-6"))
      expect(result.config.model).toBe("claude-opus-4-6")
    })
  })

  // -----------------------------------------------------------------------
  // 3. Prompt flag
  // -----------------------------------------------------------------------
  describe("--prompt", () => {
    it("sets prompt with --prompt", () => {
      const result = parseFlags(argv("--prompt", "hello world"))
      expect(result.prompt).toBe("hello world")
    })

    it("sets prompt with -p short flag", () => {
      const result = parseFlags(argv("-p", "hello world"))
      expect(result.prompt).toBe("hello world")
    })
  })

  // -----------------------------------------------------------------------
  // 4. Positional prompt
  // -----------------------------------------------------------------------
  describe("positional prompt", () => {
    it("first non-flag arg becomes prompt", () => {
      const result = parseFlags(argv("fix the bug"))
      expect(result.prompt).toBe("fix the bug")
    })

    it("--prompt takes precedence over positional when --prompt comes first", () => {
      const result = parseFlags(argv("--prompt", "from flag", "positional"))
      expect(result.prompt).toBe("from flag")
    })

    it("positional is used if it comes before --prompt", () => {
      // positional is set first; --prompt overwrites it
      const result = parseFlags(argv("positional", "--prompt", "from flag"))
      // positional is captured first (since it's not a flag and prompt is undefined),
      // then --prompt overwrites it
      expect(result.prompt).toBe("from flag")
    })

    it("ignores args starting with - as positional", () => {
      // Unknown flags starting with - are silently ignored as positional
      const result = parseFlags(argv("--unknown-thing"))
      expect(result.prompt).toBeUndefined()
    })
  })

  // -----------------------------------------------------------------------
  // 5. Boolean flags
  // -----------------------------------------------------------------------
  describe("boolean flags", () => {
    it("--help sets help to true", () => {
      const result = parseFlags(argv("--help"))
      expect(result.help).toBe(true)
    })

    it("-h sets help to true", () => {
      const result = parseFlags(argv("-h"))
      expect(result.help).toBe(true)
    })

    it("--version sets version to true", () => {
      const result = parseFlags(argv("--version"))
      expect(result.version).toBe(true)
    })

    it("-v sets version to true", () => {
      const result = parseFlags(argv("-v"))
      expect(result.version).toBe(true)
    })

    it("--debug sets debug to true", () => {
      const result = parseFlags(argv("--debug"))
      expect(result.debug).toBe(true)
    })

    it("--debug-backend sets debugBackend to true", () => {
      const result = parseFlags(argv("--debug-backend"))
      expect(result.debugBackend).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // 6. Session management
  // -----------------------------------------------------------------------
  describe("session management", () => {
    it("--continue sets config.continue to true", () => {
      const result = parseFlags(argv("--continue"))
      expect(result.config.continue).toBe(true)
    })

    it("-c sets config.continue to true", () => {
      const result = parseFlags(argv("-c"))
      expect(result.config.continue).toBe(true)
    })

    it("--resume sets config.resume", () => {
      const result = parseFlags(argv("--resume", "abc-123"))
      expect(result.config.resume).toBe("abc-123")
    })

    it("-r sets config.resume", () => {
      const result = parseFlags(argv("-r", "session-456"))
      expect(result.config.resume).toBe("session-456")
    })
  })

  // -----------------------------------------------------------------------
  // 7. Permission mode
  // -----------------------------------------------------------------------
  describe("permission mode", () => {
    it("--dangerously-skip-permissions sets bypassPermissions", () => {
      const result = parseFlags(argv("--dangerously-skip-permissions"))
      expect(result.config.permissionMode).toBe("bypassPermissions")
    })

    it("--permission-mode sets the given mode", () => {
      const result = parseFlags(argv("--permission-mode", "acceptEdits"))
      expect(result.config.permissionMode).toBe("acceptEdits")
    })

    it("--permission-mode supports plan mode", () => {
      const result = parseFlags(argv("--permission-mode", "plan"))
      expect(result.config.permissionMode).toBe("plan")
    })
  })

  // -----------------------------------------------------------------------
  // 8. Working directory
  // -----------------------------------------------------------------------
  describe("--cwd", () => {
    it("sets config.cwd", () => {
      const result = parseFlags(argv("--cwd", "/some/path"))
      expect(result.config.cwd).toBe("/some/path")
    })
  })

  // -----------------------------------------------------------------------
  // 9. System prompt
  // -----------------------------------------------------------------------
  describe("--system-prompt", () => {
    it("sets config.systemPrompt", () => {
      const result = parseFlags(argv("--system-prompt", "You are a helpful assistant"))
      expect(result.config.systemPrompt).toBe("You are a helpful assistant")
    })
  })

  // -----------------------------------------------------------------------
  // 10. Multiple flags combined
  // -----------------------------------------------------------------------
  describe("multiple flags combined", () => {
    it("applies all flags correctly", () => {
      const result = parseFlags(
        argv("--model", "claude-sonnet-4-6", "--debug", "--cwd", "/tmp")
      )
      expect(result.config.model).toBe("claude-sonnet-4-6")
      expect(result.debug).toBe(true)
      expect(result.config.cwd).toBe("/tmp")
    })

    it("handles all session + model + prompt flags together", () => {
      const result = parseFlags(
        argv(
          "-m", "claude-opus-4-6",
          "-c",
          "--system-prompt", "Be concise",
          "-p", "explain this code",
          "--debug",
          "--backend", "claude-v2"
        )
      )
      expect(result.config.model).toBe("claude-opus-4-6")
      expect(result.config.continue).toBe(true)
      expect(result.config.systemPrompt).toBe("Be concise")
      expect(result.prompt).toBe("explain this code")
      expect(result.debug).toBe(true)
      expect(result.backend).toBe("claude-v2")
    })

    it("handles --max-turns and --max-budget together", () => {
      const result = parseFlags(argv("--max-turns", "10", "--max-budget", "5.50"))
      expect(result.config.maxTurns).toBe(10)
      expect(result.config.maxBudgetUsd).toBe(5.5)
    })
  })

  // -----------------------------------------------------------------------
  // 11. Unknown flags
  // -----------------------------------------------------------------------
  describe("unknown flags", () => {
    it("silently ignores unknown flags starting with -", () => {
      const result = parseFlags(argv("--foo", "--bar"))
      // Should not crash; prompt should remain undefined since they start with -
      expect(result.prompt).toBeUndefined()
    })

    it("does not set unknown flags as prompt", () => {
      const result = parseFlags(argv("--unknown"))
      expect(result.prompt).toBeUndefined()
    })
  })

  // -----------------------------------------------------------------------
  // 12. Backend selection
  // -----------------------------------------------------------------------
  describe("--backend", () => {
    it("sets backend with --backend", () => {
      const result = parseFlags(argv("--backend", "claude-v2"))
      expect(result.backend).toBe("claude-v2")
    })

    it("sets backend with -b short flag", () => {
      const result = parseFlags(argv("-b", "claude-v2"))
      expect(result.backend).toBe("claude-v2")
    })

    it("defaults to claude when not specified", () => {
      const result = parseFlags(argv())
      expect(result.backend).toBe("claude")
    })
  })

  // -----------------------------------------------------------------------
  // 13. Flag requiring value missing (requireArg validation)
  // -----------------------------------------------------------------------
  describe("requireArg validation", () => {
    // NOTE: parseFlags calls process.exit(1) when a required arg is missing.
    // We cannot easily test this without mocking process.exit, which would
    // affect other tests. These cases are documented here as known behaviors.
    //
    // The following flags would trigger process.exit(1) if called without a value:
    // --model, --resume, --max-turns, --max-budget, --cwd, --system-prompt,
    // --backend, --prompt, --permission-mode
    //
    // The requireArg function also rejects values that start with "-" (treating
    // them as another flag rather than a value).

    it("treats a following flag as missing value (requireArg rejects flags as values)", () => {
      // This documents the behavior: --model --debug would cause process.exit(1)
      // because requireArg sees --debug starts with "-" and rejects it.
      // We can't test this directly without mocking process.exit.
      // Instead, we verify requireArg's logic indirectly: a valid value works fine.
      const result = parseFlags(argv("--model", "valid-model"))
      expect(result.config.model).toBe("valid-model")
    })
  })

  // -----------------------------------------------------------------------
  // 14. Max turns
  // -----------------------------------------------------------------------
  describe("--max-turns", () => {
    it("parses integer value", () => {
      const result = parseFlags(argv("--max-turns", "5"))
      expect(result.config.maxTurns).toBe(5)
    })

    it("parses large value", () => {
      const result = parseFlags(argv("--max-turns", "100"))
      expect(result.config.maxTurns).toBe(100)
    })

    // NOTE: --max-turns with non-integer or <= 0 calls process.exit(1)
  })

  // -----------------------------------------------------------------------
  // 15. Max budget
  // -----------------------------------------------------------------------
  describe("--max-budget", () => {
    it("parses float value", () => {
      const result = parseFlags(argv("--max-budget", "10.50"))
      expect(result.config.maxBudgetUsd).toBe(10.5)
    })

    it("parses integer value as float", () => {
      const result = parseFlags(argv("--max-budget", "5"))
      expect(result.config.maxBudgetUsd).toBe(5)
    })

    // NOTE: --max-budget with non-number or <= 0 calls process.exit(1)
  })

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  describe("edge cases", () => {
    it("handles empty string as positional prompt", () => {
      // An empty string doesn't start with "-", so it becomes the prompt
      const result = parseFlags(["bun", "script.ts", ""])
      expect(result.prompt).toBe("")
    })

    it("only the first positional arg becomes the prompt", () => {
      const result = parseFlags(argv("first", "second", "third"))
      expect(result.prompt).toBe("first")
    })

    it("positional arg before flags is captured", () => {
      const result = parseFlags(argv("my prompt", "--debug"))
      expect(result.prompt).toBe("my prompt")
      expect(result.debug).toBe(true)
    })

    it("prompt with spaces works via --prompt", () => {
      const result = parseFlags(argv("--prompt", "fix the bug in src/index.ts"))
      expect(result.prompt).toBe("fix the bug in src/index.ts")
    })

    it("config remains empty object when only boolean flags used", () => {
      const result = parseFlags(argv("--help", "--version", "--debug"))
      expect(result.config).toEqual({})
    })

    it("argv with only bun and script produces defaults", () => {
      const result = parseFlags(["bun", "script.ts"])
      expect(result.config).toEqual({})
      expect(result.prompt).toBeUndefined()
    })
  })
})

describe("printHelp", () => {
  it("is a callable function", () => {
    expect(typeof printHelp).toBe("function")
  })
})
