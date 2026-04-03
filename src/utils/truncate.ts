/**
 * Smart path and text truncation utilities.
 *
 * Ported from Claude Code's src/utils/truncate.ts with a simplified
 * width-measurement approach that avoids external dependencies.
 */

const ELLIPSIS = "\u2026" // …

/** Measure the display width of a string in terminal columns.
 *  Strips ANSI escape codes and uses character count (sufficient for
 *  most file-path scenarios; avoids external packages). */
export function stringWidth(str: string): number {
  // Strip ANSI escape codes (SGR sequences, cursor movement, etc.)
  const clean = str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
  return clean.length
}

// ---------------------------------------------------------------------------
// Core truncation primitives
// ---------------------------------------------------------------------------

/** Truncate `text` at the end to fit within `maxWidth`, appending `…`. */
export function truncateToWidth(text: string, maxWidth: number): string {
  if (maxWidth < 1) return ""
  if (stringWidth(text) <= maxWidth) return text
  if (maxWidth === 1) return ELLIPSIS
  // Leave room for the ellipsis character (width 1)
  const trimmed = text.slice(0, maxWidth - 1)
  return trimmed + ELLIPSIS
}

/** Truncate `text` at the start to fit within `maxWidth`, prepending `…`. */
export function truncateStartToWidth(text: string, maxWidth: number): string {
  if (maxWidth < 1) return ""
  if (stringWidth(text) <= maxWidth) return text
  if (maxWidth === 1) return ELLIPSIS
  const trimmed = text.slice(text.length - (maxWidth - 1))
  return ELLIPSIS + trimmed
}

/** Truncate `text` at the end to fit within `maxWidth`, without adding an
 *  ellipsis. Useful for composing truncated segments. */
export function truncateToWidthNoEllipsis(text: string, maxWidth: number): string {
  if (maxWidth < 1) return ""
  if (stringWidth(text) <= maxWidth) return text
  return text.slice(0, maxWidth)
}

// ---------------------------------------------------------------------------
// Path-aware middle truncation
// ---------------------------------------------------------------------------

/** Truncate a file path in the middle to preserve both directory context and
 *  the filename.
 *
 *  Example: `"src/components/deeply/nested/folder/MyComponent.tsx"`
 *           -> `"src/components/…/MyComponent.tsx"` when maxLength is 35.
 *
 *  Algorithm:
 *  1. If the path fits, return as-is.
 *  2. Split at the last `/` into directory and filename.
 *  3. If the filename alone exceeds maxLength, use `truncateStartToWidth()`.
 *  4. Otherwise: trimmed directory + `…/` + filename. */
export function truncatePathMiddle(path: string, maxLength: number): string {
  if (maxLength < 1) return ""
  if (stringWidth(path) <= maxLength) return path

  const lastSlash = path.lastIndexOf("/")
  if (lastSlash === -1) {
    // No directory component — truncate from the start so the tail
    // (usually the extension) is preserved.
    return truncateStartToWidth(path, maxLength)
  }

  const dir = path.slice(0, lastSlash)   // everything before the last /
  const file = path.slice(lastSlash + 1) // filename after the last /

  // If the filename alone (plus ellipsis prefix) won't fit, just start-truncate.
  // We need at minimum: `…/` (2 chars) + file
  if (stringWidth(file) + 2 > maxLength) {
    return truncateStartToWidth(path, maxLength)
  }

  // Budget for the directory portion: maxLength - `/` - file - `…`
  const dirBudget = maxLength - 1 - stringWidth(file) - 1 // -1 for `/`, -1 for `…`
  if (dirBudget <= 0) {
    return ELLIPSIS + "/" + file
  }

  const trimmedDir = truncateToWidthNoEllipsis(dir, dirBudget)
  return trimmedDir + ELLIPSIS + "/" + file
}

// ---------------------------------------------------------------------------
// Unified truncate
// ---------------------------------------------------------------------------

/** Unified truncation helper.
 *
 *  - When `singleLine` is true, collapses internal newlines into spaces
 *    before truncating.
 *  - Always truncates at the end with `…`. */
export function truncate(str: string, maxWidth: number, singleLine?: boolean): string {
  if (singleLine) {
    str = str.replace(/\n/g, " ")
  }
  return truncateToWidth(str, maxWidth)
}

// ---------------------------------------------------------------------------
// Text wrapping
// ---------------------------------------------------------------------------

/** Wrap `text` into lines of at most `width` characters.
 *  Breaks on whitespace when possible; hard-breaks long words. */
export function wrapText(text: string, width: number): string[] {
  if (width < 1) return []
  const result: string[] = []

  for (const rawLine of text.split("\n")) {
    if (stringWidth(rawLine) <= width) {
      result.push(rawLine)
      continue
    }

    // Word-wrap this line
    const words = rawLine.split(/(\s+)/)
    let current = ""

    for (const word of words) {
      if (current.length === 0) {
        // Start of a new wrapped line
        if (stringWidth(word) <= width) {
          current = word
        } else {
          // Hard-break the long word
          for (let i = 0; i < word.length; i += width) {
            const chunk = word.slice(i, i + width)
            if (i + width < word.length) {
              result.push(chunk)
            } else {
              current = chunk
            }
          }
        }
      } else if (stringWidth(current) + stringWidth(word) <= width) {
        current += word
      } else {
        result.push(current)
        // Trim leading whitespace from the continuation
        const trimmed = word.replace(/^\s+/, "")
        if (stringWidth(trimmed) <= width) {
          current = trimmed
        } else {
          current = ""
          for (let i = 0; i < trimmed.length; i += width) {
            const chunk = trimmed.slice(i, i + width)
            if (i + width < trimmed.length) {
              result.push(chunk)
            } else {
              current = chunk
            }
          }
        }
      }
    }

    if (current.length > 0) {
      result.push(current)
    }
  }

  return result
}
