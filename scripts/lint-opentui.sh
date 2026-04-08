#!/bin/bash
# Checks for common OpenTUI prop mistakes that silently break styling or crash the FFI.
# Run via: bun run lint:opentui
#
# Uses POSIX-compatible grep (no -P flag) so it works on both macOS and Linux.

set -uo pipefail

errors=0

# Check for color= on <text> elements (should be fg=).
# Exclude borderColor (valid prop) and comments.
if grep -rn --include="*.tsx" --include="*.ts" -E '[^r]color=' src/tui/ 2>/dev/null \
   | grep -v 'borderColor' \
   | grep -v '//' \
   | grep -v '\.test\.' \
   | grep -q .; then
  grep -rn --include="*.tsx" --include="*.ts" -E '[^r]color=' src/tui/ 2>/dev/null \
    | grep -v 'borderColor' \
    | grep -v '//' \
    | grep -v '\.test\.'
  echo "ERROR: Use fg= instead of color= on <text> elements"
  errors=1
fi

# Check for boolean bold/dimmed/italic props (should be attributes={TextAttributes.X}).
# Match bold/dimmed/italic as JSX props (preceded by space or start-of-tag), not inside strings or comments.
if grep -rn --include="*.tsx" --include="*.ts" -E '[ ]+(bold|dimmed|italic)[ >={]' src/tui/ 2>/dev/null \
   | grep -v '//' \
   | grep -v 'TextAttributes' \
   | grep -v '\.test\.' \
   | grep -v ' \* ' \
   | grep -v '{/\*' \
   | grep -v '/\*' \
   | grep -q .; then
  grep -rn --include="*.tsx" --include="*.ts" -E '[ ]+(bold|dimmed|italic)[ >={]' src/tui/ 2>/dev/null \
    | grep -v '//' \
    | grep -v 'TextAttributes' \
    | grep -v '\.test\.' \
    | grep -v ' \* ' \
    | grep -v '{/\*' \
    | grep -v '/\*'
  echo "ERROR: Use attributes={TextAttributes.BOLD|DIM|ITALIC} instead of boolean props"
  errors=1
fi

# Check for numeric fg= values (crashes Zig FFI BigInt packing).
if grep -rn --include="*.tsx" --include="*.ts" -E 'fg=\{[0-9]' src/tui/ 2>/dev/null | grep -v '//' | grep -v ' \* ' | grep -q .; then
  grep -rn --include="*.tsx" --include="*.ts" -E 'fg=\{[0-9]' src/tui/ 2>/dev/null | grep -v '//' | grep -v ' \* '
  echo "ERROR: Use hex strings (fg=\"#d78787\") instead of numeric ANSI codes (fg={174})"
  errors=1
fi

# Check for numeric color= values (crashes Zig FFI BigInt packing).
if grep -rn --include="*.tsx" --include="*.ts" -E 'color=\{[0-9]' src/tui/ 2>/dev/null | grep -q .; then
  grep -rn --include="*.tsx" --include="*.ts" -E 'color=\{[0-9]' src/tui/ 2>/dev/null
  echo "ERROR: Use hex strings (fg=\"#d78787\") instead of numeric color codes (color={174})"
  errors=1
fi

# Check for await render() (causes immediate process exit).
if grep -rn --include="*.tsx" --include="*.ts" 'await render(' src/tui/ 2>/dev/null | grep -q .; then
  grep -rn --include="*.tsx" --include="*.ts" 'await render(' src/tui/ 2>/dev/null
  echo "ERROR: Do not await render() — OpenTUI's native event loop keeps the process alive"
  errors=1
fi

# Check for dims()?.columns (correct is dims()?.width).
if grep -rn --include="*.tsx" --include="*.ts" 'dims()?.columns' src/tui/ 2>/dev/null | grep -q .; then
  grep -rn --include="*.tsx" --include="*.ts" 'dims()?.columns' src/tui/ 2>/dev/null
  echo "ERROR: Use dims()?.width instead of dims()?.columns"
  errors=1
fi

# Check for scrollToEnd() (correct is scrollBy() or scrollTo()).
if grep -rn --include="*.tsx" --include="*.ts" 'scrollToEnd()' src/tui/ 2>/dev/null | grep -q .; then
  grep -rn --include="*.tsx" --include="*.ts" 'scrollToEnd()' src/tui/ 2>/dev/null
  echo "ERROR: Use scrollBy() or scrollTo() instead of scrollToEnd()"
  errors=1
fi

# Check for keyed <Show> where && puts a boolean last (keyed callback gets true instead of the object).
# Pattern: <Show when={obj() && boolExpr}>{(val) => ...}  — val would be true, not obj.
# Safe pattern: <Show when={boolExpr && obj()}>{(val) => ...}  — val is the object.
if grep -rn --include="*.tsx" -E 'Show when=\{.*\(\) &&[^}]+\}>\{\(' src/tui/ 2>/dev/null \
   | grep -v '//' \
   | grep -v '\.test\.' \
   | grep -q .; then
  grep -rn --include="*.tsx" -E 'Show when=\{.*\(\) &&[^}]+\}>\{\(' src/tui/ 2>/dev/null \
    | grep -v '//' \
    | grep -v '\.test\.'
  echo "ERROR: Keyed <Show> with && must put the object last: <Show when={bool && obj()}>{(v) => v().prop}</Show>"
  errors=1
fi

# Check for hardcoded named colors (should use design tokens from theme/tokens.ts).
# Matches fg="gray", fg="white", fg="red", fg="green", fg="yellow", fg="blue" etc.
# Excludes borderColor (valid named color prop) and comments.
if grep -rn --include="*.tsx" --include="*.ts" -E 'fg="(gray|white|red|green|yellow|blue)"' src/tui/ 2>/dev/null \
   | grep -v '//' \
   | grep -v '\.test\.' \
   | grep -q .; then
  grep -rn --include="*.tsx" --include="*.ts" -E 'fg="(gray|white|red|green|yellow|blue)"' src/tui/ 2>/dev/null \
    | grep -v '//' \
    | grep -v '\.test\.'
  echo "ERROR: Use design tokens (colors.text.primary, colors.text.subtle, etc.) instead of hardcoded named colors"
  errors=1
fi

# Check for colors.text.subtle on <text> elements (invisible on dark backgrounds).
# Allow subtle in syntax.ts (tree-sitter styles) and in comments.
if grep -rn --include="*.tsx" --include="*.ts" 'colors\.text\.subtle' src/tui/ src/commands/ src/storybook/ 2>/dev/null \
   | grep -v 'syntax\.ts' \
   | grep -v 'tokens\.ts' \
   | grep -v '//' \
   | grep -v ' \* ' \
   | grep -v '\.test\.' \
   | grep -q .; then
  grep -rn --include="*.tsx" --include="*.ts" 'colors\.text\.subtle' src/tui/ src/commands/ src/storybook/ 2>/dev/null \
    | grep -v 'syntax\.ts' \
    | grep -v 'tokens\.ts' \
    | grep -v '//' \
    | grep -v ' \* ' \
    | grep -v '\.test\.'
  echo "ERROR: Never use colors.text.subtle on <text> elements — use colors.text.inactive instead"
  errors=1
fi

# Check for external signal reads inside <For> callbacks.
# Pattern: <For each={...}> followed by a callback that reads a signal/memo
# other than the item/index params. We detect the most dangerous pattern:
# calling the same memo/accessor that provides the <For>'s `each` inside the callback.
# This is a heuristic — can't catch all cases, but catches the most common one.
#
# Matches: <For each={someList()}> ... { ... someList() ... }
# The grep finds <For blocks where the each= accessor is called again inside the callback body.
for_signal_reread=$(grep -rn --include="*.tsx" '<For each=' src/tui/ src/commands/ 2>/dev/null \
  | while IFS=: read -r file line rest; do
    # Extract the accessor name from each={accessor()}
    accessor=$(echo "$rest" | sed -n 's/.*<For each={\([a-zA-Z_]*\)()}.*/\1/p')
    if [ -n "$accessor" ]; then
      # Check if the same accessor is called again in the next 20 lines (callback body)
      end=$((line + 20))
      if sed -n "${line},${end}p" "$file" | grep -q "${accessor}()" 2>/dev/null; then
        # Exclude lines that are just the <For each= line itself
        count=$(sed -n "${line},${end}p" "$file" | grep -c "${accessor}()" 2>/dev/null)
        if [ "$count" -gt 1 ]; then
          echo "${file}:${line}: re-reads ${accessor}() inside <For> callback"
        fi
      fi
    fi
  done)

if [ -n "$for_signal_reread" ]; then
  echo "$for_signal_reread"
  echo "ERROR: Do not re-read the list accessor inside a <For> callback — pre-compute in a memo or use <Index>"
  errors=1
fi

if [ $errors -eq 0 ]; then
  echo "OpenTUI prop checks passed"
fi

exit $errors
