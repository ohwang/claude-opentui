/**
 * Unified diff builders.
 *
 * OpenTUI's `<diff>` renderable parses the standard unified diff format:
 *
 *   --- a/path
 *   +++ b/path
 *   @@ -oldStart,oldLen +newStart,newLen @@
 *   -removed line
 *   +added line
 *    context line
 *
 * Backends produce file edits in different shapes (Claude: old_string/new_string;
 * ACP: oldText/newText; Codex: path+kind only). This module normalizes any
 * (path, oldText, newText) triple into the format `<diff>` expects so the
 * renderer, plus the `isDiffOutput()` detector in tool-view.tsx, work
 * consistently across adapters.
 */

export interface UnifiedDiffInput {
  path: string
  oldText: string
  newText: string
}

/**
 * Build a unified diff from a (path, oldText, newText) triple.
 *
 * This produces a "whole-file hunk" diff — every old line is rendered as
 * removed, every new line as added, with no context lines. That's intentional:
 * the TUI's `<diff>` just needs a valid unified diff it can parse, and the
 * renderer is the one that applies syntax highlighting + colored gutters.
 *
 * Empty oldText (file creation) produces `--- /dev/null` per `diff(1)`
 * convention; empty newText (file deletion) produces `+++ /dev/null`.
 */
export function buildUnifiedDiff({ path, oldText, newText }: UnifiedDiffInput): string {
  const oldLines = oldText === "" ? [] : oldText.split("\n")
  const newLines = newText === "" ? [] : newText.split("\n")

  const fromHeader = oldLines.length === 0 ? "/dev/null" : `a/${path}`
  const toHeader = newLines.length === 0 ? "/dev/null" : `b/${path}`

  const lines: string[] = []
  lines.push(`--- ${fromHeader}`)
  lines.push(`+++ ${toHeader}`)

  const oldStart = oldLines.length === 0 ? 0 : 1
  const newStart = newLines.length === 0 ? 0 : 1
  lines.push(`@@ -${oldStart},${oldLines.length} +${newStart},${newLines.length} @@`)

  for (const line of oldLines) {
    lines.push(`-${line}`)
  }
  for (const line of newLines) {
    lines.push(`+${line}`)
  }

  return lines.join("\n")
}

/** A string-level check: does this text contain unified-diff markers? */
export function looksLikeUnifiedDiff(text: string): boolean {
  return text.includes("--- ") && text.includes("+++ ") && text.includes("@@")
}
