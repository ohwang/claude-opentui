#!/usr/bin/env bash
#
# bump-version.sh — Bump the project version following semver.
#
# Usage:
#   ./scripts/bump-version.sh <patch|minor|major> [--dry-run] [--no-verify]
#   ./scripts/bump-version.sh --set 1.2.3 [--dry-run] [--no-verify]
#
# What it does:
#   1. Validates clean working tree and current branch
#   2. Runs lint + tests (unless --no-verify)
#   3. Computes the new version
#   4. Updates package.json
#   5. Moves CHANGELOG.md [Unreleased] entries to a dated version section
#   6. Commits the version bump
#   7. Creates an annotated git tag (v<version>)
#
# The tag push triggers .github/workflows/release.yml to create a GitHub Release.

set -euo pipefail

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

info()  { echo -e "${CYAN}▸${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
die()   { echo -e "${RED}✗${NC} $*" >&2; exit 1; }

# ── Parse args ───────────────────────────────────────────────────────────────
BUMP_TYPE=""
SET_VERSION=""
DRY_RUN=false
NO_VERIFY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    patch|minor|major)
      BUMP_TYPE="$1"
      shift
      ;;
    --set)
      SET_VERSION="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --no-verify)
      NO_VERIFY=true
      shift
      ;;
    -h|--help)
      echo "Usage: $0 <patch|minor|major> [--dry-run] [--no-verify]"
      echo "       $0 --set <version> [--dry-run] [--no-verify]"
      echo ""
      echo "Options:"
      echo "  patch        Bump patch version (0.0.1 -> 0.0.2)"
      echo "  minor        Bump minor version (0.0.1 -> 0.1.0)"
      echo "  major        Bump major version (0.0.1 -> 1.0.0)"
      echo "  --set VER    Set an explicit version (e.g. 1.0.0-beta.1)"
      echo "  --dry-run    Show what would happen without making changes"
      echo "  --no-verify  Skip lint and test checks"
      exit 0
      ;;
    *)
      die "Unknown argument: $1. Use --help for usage."
      ;;
  esac
done

if [[ -z "$BUMP_TYPE" && -z "$SET_VERSION" ]]; then
  die "Missing bump type. Usage: $0 <patch|minor|major> or $0 --set <version>"
fi

# ── Resolve project root ────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# ── Pre-flight checks ───────────────────────────────────────────────────────
info "Running pre-flight checks..."

# Clean working tree
if ! git diff --quiet || ! git diff --cached --quiet; then
  die "Working tree is dirty. Commit or stash changes first."
fi

# Untracked files that matter (ignore node_modules, .claude, etc.)
UNTRACKED=$(git ls-files --others --exclude-standard -- ':!node_modules' ':!.claude' 2>/dev/null | head -5)
if [[ -n "$UNTRACKED" ]]; then
  die "Untracked files found. Commit or remove them first:\n$UNTRACKED"
fi

# Branch check — warn if not on main
CURRENT_BRANCH=$(git branch --show-current)
if [[ "$CURRENT_BRANCH" != "main" && "$CURRENT_BRANCH" != "master" ]]; then
  warn "You are on branch '${CURRENT_BRANCH}', not main. Proceed? (y/N)"
  read -r CONFIRM
  if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
    die "Aborted."
  fi
fi

ok "Working tree is clean, on branch '${CURRENT_BRANCH}'"

# ── Read current version ────────────────────────────────────────────────────
CURRENT_VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"\([0-9][^"]*\)".*/\1/')
if [[ -z "$CURRENT_VERSION" ]]; then
  die "Could not read current version from package.json"
fi
info "Current version: ${BOLD}${CURRENT_VERSION}${NC}"

# ── Compute new version ─────────────────────────────────────────────────────
if [[ -n "$SET_VERSION" ]]; then
  NEW_VERSION="$SET_VERSION"
else
  IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
  # Strip any pre-release suffix from patch for arithmetic
  PATCH_NUM="${PATCH%%-*}"
  case "$BUMP_TYPE" in
    major) NEW_VERSION="$((MAJOR + 1)).0.0" ;;
    minor) NEW_VERSION="${MAJOR}.$((MINOR + 1)).0" ;;
    patch) NEW_VERSION="${MAJOR}.${MINOR}.$((PATCH_NUM + 1))" ;;
  esac
fi

info "New version:     ${BOLD}${NEW_VERSION}${NC}"

# Check tag doesn't already exist
if git tag -l "v${NEW_VERSION}" | grep -q .; then
  die "Tag v${NEW_VERSION} already exists. Choose a different version."
fi

# ── Run verification (unless --no-verify) ────────────────────────────────────
if [[ "$NO_VERIFY" == "false" ]]; then
  info "Running lint..."
  if ! bun run lint; then
    die "Lint failed. Fix issues before bumping."
  fi
  ok "Lint passed"

  info "Running tests..."
  if ! bun test --timeout 30000; then
    die "Tests failed. Fix issues before bumping."
  fi
  ok "Tests passed"
else
  warn "Skipping verification (--no-verify)"
fi

# ── Dry run bail ─────────────────────────────────────────────────────────────
if [[ "$DRY_RUN" == "true" ]]; then
  echo ""
  info "${YELLOW}DRY RUN${NC} — would have done:"
  echo "  1. Update package.json version: ${CURRENT_VERSION} -> ${NEW_VERSION}"
  echo "  2. Update CHANGELOG.md [Unreleased] -> [${NEW_VERSION}]"
  echo "  3. Commit: \"release: v${NEW_VERSION}\""
  echo "  4. Tag: v${NEW_VERSION}"
  echo ""
  echo "  To apply: re-run without --dry-run"
  exit 0
fi

# ── Update package.json ─────────────────────────────────────────────────────
info "Updating package.json..."
# Use a temp file to avoid sed -i portability issues
TMPFILE=$(mktemp)
sed "s/\"version\": \"${CURRENT_VERSION}\"/\"version\": \"${NEW_VERSION}\"/" package.json > "$TMPFILE"
mv "$TMPFILE" package.json
ok "package.json updated"

# ── Update CHANGELOG.md ─────────────────────────────────────────────────────
CHANGELOG="CHANGELOG.md"
if [[ -f "$CHANGELOG" ]]; then
  info "Updating CHANGELOG.md..."
  TODAY=$(date +%Y-%m-%d)
  TMPFILE=$(mktemp)

  # Replace [Unreleased] header with versioned header, add new empty Unreleased
  awk -v ver="$NEW_VERSION" -v date="$TODAY" '
    /^## \[Unreleased\]/ {
      print "## [Unreleased]"
      print ""
      print "## [" ver "] - " date
      next
    }
    { print }
  ' "$CHANGELOG" > "$TMPFILE"
  mv "$TMPFILE" "$CHANGELOG"
  ok "CHANGELOG.md updated"
else
  warn "No CHANGELOG.md found — skipping changelog update"
fi

# ── Commit and tag ───────────────────────────────────────────────────────────
info "Committing version bump..."
git add package.json
[[ -f "$CHANGELOG" ]] && git add "$CHANGELOG"

git commit -m "$(cat <<EOF
release: v${NEW_VERSION}
EOF
)"
ok "Committed"

info "Creating tag v${NEW_VERSION}..."
git tag -a "v${NEW_VERSION}" -m "Release v${NEW_VERSION}"
ok "Tagged v${NEW_VERSION}"

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}Version bumped: v${CURRENT_VERSION} -> v${NEW_VERSION}${NC}"
echo ""
echo "Next steps:"
echo "  1. Review the commit:    git log --oneline -1"
echo "  2. Push with tags:       git push && git push --tags"
echo "     (This triggers the GitHub Release workflow)"
echo ""
