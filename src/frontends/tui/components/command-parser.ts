/**
 * Slash command string parsing — extracted from input-area.tsx
 *
 * Parses shell-like command strings into argv arrays, preserving quoted segments.
 */

/**
 * Parse a shell-like command string into argv, preserving quoted segments.
 * Needed for editor commands such as:
 *   /Applications/Visual Studio Code.app/.../code --wait
 *   open -a "Visual Studio Code" --wait-apps
 */
export function parseCommandString(command: string): string[] {
  const input = command.trim()
  if (!input) return []

  const args: string[] = []
  let current = ""
  let quote: "'" | '"' | null = null
  let escaped = false

  for (const ch of input) {
    if (escaped) {
      current += ch
      escaped = false
      continue
    }

    if (ch === "\\" && quote !== "'") {
      escaped = true
      continue
    }

    if (ch === "'" || ch === "\"") {
      if (quote === ch) {
        quote = null
      } else if (quote === null) {
        quote = ch
      } else {
        current += ch
      }
      continue
    }

    if (!quote && /\s/.test(ch)) {
      if (current) {
        args.push(current)
        current = ""
      }
      continue
    }

    current += ch
  }

  if (escaped) current += "\\"
  if (current) args.push(current)
  return args
}
