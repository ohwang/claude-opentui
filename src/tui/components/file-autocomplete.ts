/**
 * File Autocomplete — fuzzy file search for @-mention file picker
 *
 * Discovery chain: rg --files -> git ls-files -> walkDir fallback
 * Fuzzy scoring: fuzzysort (same as OpenCode)
 * Supports path prefixes: @../, @~/, @/absolute/ to search outside cwd
 * Caches per root directory with LRU eviction.
 */

import fuzzysort from "fuzzysort"
import { readdirSync, statSync } from "fs"
import { homedir } from "os"
import { join, resolve, relative, dirname, sep } from "path"
import { log } from "../../utils/logger"

// ── Configuration ────────────────────────────────────────────────────
const MAX_SUGGESTIONS = 15
const REFRESH_THROTTLE_MS = 5_000
const FALLBACK_MAX_DEPTH = 4
const FALLBACK_MAX_FILES = 2000
/** Max files to fuzzy-match per search (prevents UI freeze in large repos) */
const MAX_FUZZY_CANDIDATES = 2000
/** Max cached root directories (LRU eviction) */
const MAX_CACHE_ENTRIES = 5
/** Max depth for broad directory scans (e.g. ~/) */
const BROAD_SCAN_MAX_DEPTH = 3

const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  ".worktrees",
  "dist",
  "build",
  ".claude",
  ".next",
  "__pycache__",
  ".cache",
  ".venv",
  "vendor",
  "target",
  ".tox",
  "coverage",
])

// ── Trigger detection ────────────────────────────────────────────────

/**
 * Match an active `@`-mention trigger anchored at the cursor.
 *
 * The `@` must be at line start or immediately after whitespace — this is the
 * rule that prevents emails (`user@example.com`), commit refs, and pasted
 * logs from activating the picker.
 *
 * Query characters are restricted to a conservative set (letters, numbers,
 * combining marks, and `_ - . / \ ( ) [ ] ~ :`) — typing a space or most
 * punctuation ends the token.
 *
 * A quoted form `@"..."` is accepted so paths containing spaces can be
 * typed explicitly.
 */
export interface AtTrigger {
  /** Index of the `@` character in the text. */
  atIndex: number
  /** The query after `@` (without quotes). */
  query: string
  /** True when the query was typed in quoted form. */
  isQuoted: boolean
}

const AT_TRIGGER_RE =
  /(^|\s)@([\p{L}\p{N}\p{M}_\-./\\()[\]~:]*|"[^"]*"?)$/u

export function matchAtTrigger(textBeforeCursor: string): AtTrigger | null {
  const m = textBeforeCursor.match(AT_TRIGGER_RE)
  if (!m) return null
  const leading = m[1] ?? ""
  const raw = m[2] ?? ""
  // Position of the `@` is the match index plus the leading whitespace length.
  const atIndex = (m.index ?? 0) + leading.length
  if (raw.startsWith('"')) {
    // Strip opening quote and (optional) closing quote.
    const unquoted = raw.endsWith('"') && raw.length >= 2
      ? raw.slice(1, -1)
      : raw.slice(1)
    return { atIndex, query: unquoted, isQuoted: true }
  }
  return { atIndex, query: raw, isQuoted: false }
}

// ── Path prefix resolution ───────────────────────────────────────────

export interface ParsedPrefix {
  /** Resolved absolute path to search within */
  root: string
  /** Remaining query to fuzzy-match against files in root */
  fuzzyQuery: string
  /** Original prefix typed by user (e.g. "../src/", "~/dev/") for reinsertion */
  prefix: string
}

/**
 * Parse a @-mention query into a search root and fuzzy query.
 *
 * Recognises three prefix forms:
 * - `../` (one or more levels) — resolve relative to cwd
 * - `~/`  — resolve relative to $HOME
 * - `/`   — absolute path
 *
 * Everything after the last `/` in the prefix is the fuzzy query.
 * Queries without a special prefix search within cwd (default).
 */
export function parsePathPrefix(query: string, cwd: string): ParsedPrefix {
  // No query → search cwd root
  if (!query) return { root: cwd, fuzzyQuery: "", prefix: "" }

  // ~/ prefix → home directory
  if (query.startsWith("~/")) {
    const rest = query.slice(2) // everything after ~/
    const lastSlash = rest.lastIndexOf("/")
    if (lastSlash >= 0) {
      const dirPart = rest.slice(0, lastSlash)
      const fuzzyQuery = rest.slice(lastSlash + 1)
      const prefix = "~/" + dirPart + "/"
      return { root: resolve(homedir(), dirPart), fuzzyQuery, prefix }
    }
    // "~/foo" → search $HOME, fuzzy query "foo"
    return { root: homedir(), fuzzyQuery: rest, prefix: "~/" }
  }

  // ../ prefix — one or more levels up
  if (query.startsWith("../")) {
    const lastSlash = query.lastIndexOf("/")
    const dirPart = query.slice(0, lastSlash)
    const fuzzyQuery = query.slice(lastSlash + 1)
    const prefix = dirPart + "/"
    return { root: resolve(cwd, dirPart), fuzzyQuery, prefix }
  }

  // / prefix — absolute path
  if (query.startsWith("/")) {
    const lastSlash = query.lastIndexOf("/")
    if (lastSlash > 0) {
      const dirPart = query.slice(0, lastSlash)
      const fuzzyQuery = query.slice(lastSlash + 1)
      const prefix = dirPart + "/"
      return { root: dirPart, fuzzyQuery, prefix }
    }
    // Just "/" → search filesystem root
    return { root: "/", fuzzyQuery: query.slice(1), prefix: "/" }
  }

  // No special prefix → search cwd, full query is fuzzy
  return { root: cwd, fuzzyQuery: query, prefix: "" }
}

// ── LRU cache ────────────────────────────────────────────────────────

interface CacheEntry {
  files: string[]
  dirs: string[]
  timestamp: number
  gitIndexMtime: number | null
}

/** LRU cache keyed by resolved root path */
const cache = new Map<string, CacheEntry>()
/** Roots currently being refreshed (prevents concurrent refreshes) */
const refreshingRoots = new Set<string>()

function evictOldestIfNeeded(): void {
  if (cache.size <= MAX_CACHE_ENTRIES) return
  // Map iterates in insertion order — first key is oldest
  const oldest = cache.keys().next().value
  if (oldest !== undefined) cache.delete(oldest)
}

function getCacheEntry(root: string): CacheEntry | undefined {
  const entry = cache.get(root)
  if (entry) {
    // Move to end (most recently used) by re-inserting
    cache.delete(root)
    cache.set(root, entry)
  }
  return entry
}

function setCacheEntry(root: string, entry: CacheEntry): void {
  cache.delete(root) // remove old position
  cache.set(root, entry) // insert at end (most recent)
  evictOldestIfNeeded()
}

// ── File discovery ───────────────────────────────────────────────────

function getGitIndexMtime(dir: string): number | null {
  try {
    return statSync(join(dir, ".git", "index")).mtimeMs
  } catch {
    return null
  }
}

function findGitRoot(cwd: string): string | null {
  let dir = cwd
  while (true) {
    try {
      statSync(join(dir, ".git"))
      return dir
    } catch {
      const parent = dirname(dir)
      if (parent === dir) return null
      dir = parent
    }
  }
}

/**
 * Discover files using ripgrep (rg --files).
 * Returns file paths relative to `root`, or null if rg is unavailable.
 */
async function getRgFiles(root: string, maxDepth?: number): Promise<string[] | null> {
  try {
    const args = ["rg", "--files", "--hidden", "--glob=!.git/*"]
    if (maxDepth !== undefined) args.push(`--max-depth=${maxDepth}`)

    const proc = Bun.spawn(args, { cwd: root, stdout: "pipe", stderr: "pipe" })
    const output = await new Response(proc.stdout).text()
    const exitCode = await proc.exited

    if (exitCode !== 0 && exitCode !== 1) return null // rg exit 1 = no matches (ok)
    return output.trim().split("\n").filter(Boolean)
  } catch {
    return null // rg not found or spawn failed
  }
}

/**
 * Discover files using git ls-files.
 * Returns file paths relative to `root`, or null if not a git repo.
 */
async function getGitFiles(root: string): Promise<string[] | null> {
  const repoRoot = findGitRoot(root)
  if (!repoRoot) return null

  try {
    const proc = Bun.spawn(
      ["git", "-c", "core.quotepath=false", "ls-files", "--recurse-submodules"],
      { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
    )
    const output = await new Response(proc.stdout).text()
    const exitCode = await proc.exited

    if (exitCode !== 0) return null

    const files = output.trim().split("\n").filter(Boolean)

    // Normalize paths relative to the search root (not repo root)
    if (root !== repoRoot) {
      return files
        .map((f) => relative(root, join(repoRoot, f)))
        .filter((f) => !f.startsWith(".."))
    }

    return files
  } catch {
    return null
  }
}

/** Fetch untracked files in background (non-gitignored) */
async function getUntrackedFiles(root: string): Promise<string[]> {
  const repoRoot = findGitRoot(root)
  if (!repoRoot) return []

  try {
    const proc = Bun.spawn(
      ["git", "-c", "core.quotepath=false", "ls-files", "--others", "--exclude-standard"],
      { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
    )
    const output = await new Response(proc.stdout).text()
    const exitCode = await proc.exited

    if (exitCode !== 0) return []

    const files = output.trim().split("\n").filter(Boolean)
    if (root !== repoRoot) {
      return files
        .map((f) => relative(root, join(repoRoot, f)))
        .filter((f) => !f.startsWith(".."))
    }
    return files
  } catch {
    return []
  }
}

/** Extract unique directory paths from file list */
function extractDirectories(files: string[]): string[] {
  const dirs = new Set<string>()
  for (const file of files) {
    let dir = dirname(file)
    while (dir !== "." && !dirs.has(dir)) {
      dirs.add(dir)
      dir = dirname(dir)
    }
  }
  return [...dirs].map((d) => d + sep)
}

/** Fallback: synchronous directory walk for non-git, non-rg repos */
function walkDir(dir: string, basePath: string, depth: number): string[] {
  if (depth > FALLBACK_MAX_DEPTH) return []
  const results: string[] = []
  try {
    const entries = readdirSync(dir)
    for (const entry of entries) {
      if (EXCLUDE_DIRS.has(entry)) continue
      if (entry.startsWith(".") && entry.length > 1) continue // skip hidden
      const fullPath = join(dir, entry)
      const relPath = relative(basePath, fullPath)
      try {
        const stat = statSync(fullPath)
        if (stat.isDirectory()) {
          results.push(relPath + "/")
          results.push(...walkDir(fullPath, basePath, depth + 1))
        } else {
          results.push(relPath)
        }
      } catch {
        /* skip unreadable */
      }
      if (results.length >= FALLBACK_MAX_FILES) break
    }
  } catch {
    /* skip unreadable dirs */
  }
  return results
}

// ── Cache management ─────────────────────────────────────────────────

/**
 * Check if the cache for a given root needs refreshing.
 */
function needsRefresh(root: string): boolean {
  const entry = cache.get(root)
  if (!entry) return true
  if (entry.files.length === 0 && entry.dirs.length === 0) return true

  // Check git index mtime for tracked file changes
  const currentMtime = getGitIndexMtime(root)
  if (currentMtime !== null && currentMtime !== entry.gitIndexMtime) return true

  // Time-based fallback
  return Date.now() - entry.timestamp >= REFRESH_THROTTLE_MS
}

/** Determine if a root is "broad" (home dir, or very high-level) and needs depth limits */
function isBroadRoot(root: string): boolean {
  const home = homedir()
  return root === home || root === "/" || root === dirname(home)
}

/**
 * Refresh the file cache for a given root.
 * Discovery chain: rg --files -> git ls-files -> walkDir
 */
async function refreshCache(root: string): Promise<void> {
  if (refreshingRoots.has(root)) return
  refreshingRoots.add(root)

  try {
    const maxDepth = isBroadRoot(root) ? BROAD_SCAN_MAX_DEPTH : undefined

    // Try ripgrep first (fastest, works everywhere)
    let files = await getRgFiles(root, maxDepth)

    // Fall back to git ls-files
    if (files === null) {
      files = await getGitFiles(root)
    }

    if (files !== null) {
      const dirs = extractDirectories(files)
      setCacheEntry(root, {
        files,
        dirs,
        timestamp: Date.now(),
        gitIndexMtime: getGitIndexMtime(root),
      })

      // Background: merge untracked files (git-only enhancement)
      getUntrackedFiles(root)
        .then((untracked) => {
          if (untracked.length > 0) {
            const entry = cache.get(root)
            if (entry) {
              const untrackedDirs = extractDirectories(untracked)
              entry.files = [...new Set([...entry.files, ...untracked])]
              entry.dirs = [...new Set([...entry.dirs, ...untrackedDirs])]
            }
          }
        })
        .catch(() => {})

      return
    }

    // Final fallback: synchronous walkDir
    const walked = walkDir(root, root, 0)
    setCacheEntry(root, {
      files: walked.filter((f) => !f.endsWith("/")),
      dirs: walked.filter((f) => f.endsWith("/")),
      timestamp: Date.now(),
      gitIndexMtime: null,
    })
  } finally {
    refreshingRoots.delete(root)
  }
}

/**
 * Get cached files + dirs for a root. On cold start, does synchronous
 * walkDir fallback so the first autocomplete isn't empty.
 * Triggers async refresh in background for better data.
 */
function getFilesForRoot(root: string): { files: string[]; dirs: string[] } {
  const entry = getCacheEntry(root)

  if (needsRefresh(root)) {
    // Cold start: synchronous fallback so dropdown isn't empty
    if (!entry || (entry.files.length === 0 && entry.dirs.length === 0)) {
      const walked = walkDir(root, root, 0)
      const files = walked.filter((f) => !f.endsWith("/"))
      const dirs = walked.filter((f) => f.endsWith("/"))
      setCacheEntry(root, { files, dirs, timestamp: Date.now(), gitIndexMtime: null })
    }
    // Async refresh upgrades the cache in background
    refreshCache(root).catch((err) => {
      log.warn("File cache refresh failed", { root, error: String(err) })
    })
  }

  const cached = cache.get(root)
  return cached ? { files: cached.files, dirs: cached.dirs } : { files: [], dirs: [] }
}

/** Invalidate all cached file lists (e.g. after a tool creates/deletes files) */
export function invalidateFileCache(): void {
  for (const entry of cache.values()) {
    entry.timestamp = 0
    entry.gitIndexMtime = null
  }
}

// ── Shallow directory listing ─────────────────────────────────────────

/**
 * List immediate children of a directory (dirs first, then files).
 * Used when the fuzzy query is empty to show a browsable directory view
 * instead of a flat recursive dump. Matches Claude Code's UX.
 */
function listShallow(root: string, limit: number): string[] {
  const dirs: string[] = []
  const files: string[] = []
  try {
    const entries = readdirSync(root)
    for (const entry of entries) {
      if (EXCLUDE_DIRS.has(entry)) continue
      if (entry.startsWith(".") && entry.length > 1) continue
      try {
        const stat = statSync(join(root, entry))
        if (stat.isDirectory()) {
          dirs.push(entry + "/")
        } else {
          files.push(entry)
        }
      } catch {
        /* skip unreadable */
      }
      if (dirs.length + files.length >= limit * 2) break // enough candidates
    }
  } catch {
    /* root doesn't exist or unreadable */
  }
  // Directories first (sorted), then files (sorted)
  dirs.sort()
  files.sort()
  return [...dirs, ...files].slice(0, limit)
}

// ── Search ───────────────────────────────────────────────────────────

/** A single file-picker suggestion. */
export interface FileSuggestion {
  /** Path relative to the resolved search root, with trailing `/` for dirs. */
  path: string
  /** True when the entry is a directory (path ends with `/`). */
  isDirectory: boolean
}

/**
 * Search files using fuzzysort. Returns up to `limit` suggestions relative
 * to the resolved search root. Handles path prefix resolution internally.
 *
 * When the fuzzy query is empty, shows a shallow directory listing (dirs
 * first) instead of a recursive file dump — enables interactive drill-down.
 * This is a deliberate UX divergence from Claude Code's recursive-fuzzy
 * behavior; see AT_MENTION_SPEC.md §3.1.
 */
export function searchFileSuggestions(
  query: string,
  cwd: string,
  limit = MAX_SUGGESTIONS,
): FileSuggestion[] {
  const { root, fuzzyQuery } = parsePathPrefix(query, cwd)

  // Empty query: show shallow browsable listing (dirs first).
  if (!fuzzyQuery) {
    return listShallow(root, limit).map(toSuggestion)
  }

  // Non-empty query: full recursive fuzzy search over files + dirs.
  const { files, dirs } = getFilesForRoot(root)
  const allEntries =
    dirs.length > 0 ? [...new Set([...files, ...dirs])] : files

  const candidates =
    allEntries.length > MAX_FUZZY_CANDIDATES
      ? allEntries.slice(0, MAX_FUZZY_CANDIDATES)
      : allEntries

  const results = fuzzysort.go(fuzzyQuery, candidates, { limit })
  return results.map((r) => toSuggestion(r.target))
}

function toSuggestion(path: string): FileSuggestion {
  return { path, isDirectory: path.endsWith("/") }
}

/**
 * Back-compat wrapper that returns just the paths. Prefer
 * `searchFileSuggestions` for new code.
 */
export function searchFiles(
  query: string,
  cwd: string,
  limit = MAX_SUGGESTIONS,
): string[] {
  return searchFileSuggestions(query, cwd, limit).map((s) => s.path)
}

/**
 * Find longest common prefix among a list of strings.
 * Used for Tab completion: fill the shared prefix before requiring a pick.
 */
export function findLongestCommonPrefix(items: string[]): string {
  if (items.length === 0) return ""
  let prefix = items[0]!
  for (let i = 1; i < items.length; i++) {
    const item = items[i]!
    while (!item.startsWith(prefix)) {
      prefix = prefix.slice(0, -1)
      if (!prefix) return ""
    }
  }
  return prefix
}
