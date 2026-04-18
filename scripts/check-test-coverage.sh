#!/usr/bin/env bash
# check-test-coverage.sh — Advisory check for missing test files
#
# For each .ts/.tsx source file under src/, checks whether a corresponding
# test file exists under tests/. Prints a warning for missing tests.
# Exit code 0 (advisory only — does not block CI).
#
# Usage:
#   bash scripts/check-test-coverage.sh           # Check all source files
#   bash scripts/check-test-coverage.sh --staged   # Check only git-staged files

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MISSING=0
TOTAL=0

# Directories/files to skip (not meaningful to test directly)
SKIP_PATTERNS=(
  "src/index.ts"
  "src/storybook/"
  "src/frontends/tui/theme/"
  "src/protocol/types.ts"
)

should_skip() {
  local file="$1"
  for pattern in "${SKIP_PATTERNS[@]}"; do
    if [[ "$file" == *"$pattern"* ]]; then
      return 0
    fi
  done
  return 1
}

# Collect source files (either all or staged)
if [[ "${1:-}" == "--staged" ]]; then
  FILES=$(cd "$ROOT" && git diff --cached --name-only --diff-filter=A | grep -E '^src/.*\.(ts|tsx)$' || true)
else
  FILES=$(cd "$ROOT" && find src -type f \( -name '*.ts' -o -name '*.tsx' \) | sort)
fi

if [[ -z "$FILES" ]]; then
  echo "No source files to check."
  exit 0
fi

while IFS= read -r src_file; do
  [[ -z "$src_file" ]] && continue
  should_skip "$src_file" && continue

  TOTAL=$((TOTAL + 1))

  # Derive expected test path: src/foo/bar.ts -> tests/foo/bar.test.ts
  # Also check common naming: tests/foo/bar-name.test.ts from src/foo/bar-name.tsx
  base="${src_file#src/}"
  base_no_ext="${base%.*}"
  dir="$(dirname "$base_no_ext")"
  name="$(basename "$base_no_ext")"

  found=false
  # Check common test locations
  for test_path in \
    "tests/${dir}/${name}.test.ts" \
    "tests/${dir}/${name}.test.tsx" \
    "tests/${name}.test.ts" \
    "tests/${name}.test.tsx"; do
    if [[ -f "$ROOT/$test_path" ]]; then
      found=true
      break
    fi
  done

  if ! $found; then
    echo "  MISSING TEST: $src_file"
    MISSING=$((MISSING + 1))
  fi
done <<< "$FILES"

echo ""
echo "Test coverage check: $((TOTAL - MISSING))/$TOTAL source files have tests ($MISSING missing)"

if [[ $MISSING -gt 0 ]]; then
  echo "  (advisory — not blocking)"
fi
