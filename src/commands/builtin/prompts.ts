/**
 * Prompt Commands — slash commands that send prompts to the model.
 *
 * Inspired by Claude Code's 'prompt' type commands (/commit, /review, /diff).
 * These inject text into the conversation as user messages.
 */

import { createPromptCommand } from "../registry"

export const bugCommand = createPromptCommand({
  name: "bug",
  description: "Report and investigate a bug",
  aliases: ["fix"],
  argumentHint: "<description of the bug>",
  prompt: (args) => args
    ? `There's a bug: ${args}\n\nPlease investigate, find the root cause, and fix it.`
    : "Please investigate the most recent error or issue and find the root cause.",
})

export const reviewCommand = createPromptCommand({
  name: "review",
  description: "Review recent code changes",
  prompt: "Please review the recent code changes (git diff). Focus on correctness, edge cases, and potential issues. Be specific about what looks good and what needs attention.",
})

export const commitCommand = createPromptCommand({
  name: "commit",
  description: "Create a git commit for staged changes",
  argumentHint: "<optional commit message hint>",
  prompt: (args) => args
    ? `Please create a git commit. Hint: ${args}`
    : "Please review the staged changes (git diff --cached) and create a well-structured git commit with a clear, descriptive message.",
})

export const testCommand = createPromptCommand({
  name: "test",
  description: "Write or run tests",
  aliases: ["tests"],
  argumentHint: "<what to test>",
  prompt: (args) => args
    ? `Please write tests for: ${args}`
    : "Please run the existing tests and report the results.",
})
