/**
 * File Autocomplete — Git-based file discovery + fuzzy search for @-mention file picker
 *
 * Uses `git ls-files` for tracked files (fast, respects .gitignore).
 * Falls back to directory walking for non-git repos.
 * Caches file list with smart refresh (watches .git/index mtime).
 */

import { readdirSync, statSync } from "fs"
import { join, relative, dirname, sep } from "path"
import { log } from "../../utils/logger"

// Configuration
const MAX_SUGGESTIONS = 15
const REFRESH_THROTTLE_MS = 5_000 // 5 seconds
const FALLBACK_MAX_DEPTH = 4 // Deeper than the old 3 for fallback
const FALLBACK_MAX_FILES = 2000 // More files for fallback
/** Cap on files to fuzzy-match per search (prevents UI freeze in large repos) */
const MAX_FUZZY_CANDIDATES = 2000

// Exclude directories for fallback walking
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

// Cache state
let cachedFiles: string[] = []
let cachedDirs: string[] = []
let cachedCwd = ""
let lastRefreshMs = 0
let lastGitIndexMtime: number | null = null
let isRefreshing = false

/**
 * Get git index mtime to detect changes without running git ls-files
 */
function getGitIndexMtime(cwd: string): number | null {
  try {
    return statSync(join(cwd, ".git", "index")).mtimeMs
  } catch {
    return null
  }
}

/**
 * Walk up from cwd to find the .git directory (repo root)
 */
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
 * Get tracked files using git ls-files (fast, respects .gitignore)
 */
async function getGitFiles(cwd: string): Promise<string[] | null> {
  const repoRoot = findGitRoot(cwd)
  if (!repoRoot) return null

  try {
    const proc = Bun.spawn(
      [
        "git",
        "-c",
        "core.quotepath=false",
        "ls-files",
        "--recurse-submodules",
      ],
      { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
    )
    const output = await new Response(proc.stdout).text()
    const exitCode = await proc.exited

    if (exitCode !== 0) return null

    const files = output.trim().split("\n").filter(Boolean)

    // Normalize paths relative to CWD (not repo root)
    if (cwd !== repoRoot) {
      return files
        .map((f) => {
          const abs = join(repoRoot, f)
          return relative(cwd, abs)
        })
        .filter((f) => !f.startsWith("..")) // Only files under CWD
    }

    return files
  } catch {
    return null
  }
}

/**
 * Get untracked files in background (non-gitignored)
 */
async function getUntrackedFiles(cwd: string): Promise<string[]> {
  const repoRoot = findGitRoot(cwd)
  if (!repoRoot) return []

  try {
    const proc = Bun.spawn(
      [
        "git",
        "-c",
        "core.quotepath=false",
        "ls-files",
        "--others",
        "--exclude-standard",
      ],
      { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
    )
    const output = await new Response(proc.stdout).text()
    const exitCode = await proc.exited

    if (exitCode !== 0) return []

    const files = output.trim().split("\n").filter(Boolean)
    if (cwd !== repoRoot) {
      return files
        .map((f) => relative(cwd, join(repoRoot, f)))
        .filter((f) => !f.startsWith(".."))
    }
    return files
  } catch {
    return []
  }
}

/**
 * Extract unique directory paths from file list (for directory completion)
 */
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

/**
 * Fallback: walk directory tree for non-git repos
 */
function walkDir(dir: string, basePath: string, depth: number): string[] {
  if (depth > FALLBACK_MAX_DEPTH) return []
  const results: string[] = []
  try {
    const entries = readdirSync(dir)
    for (const entry of entries) {
      if (EXCLUDE_DIRS.has(entry)) continue
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

/**
 * Refresh the file cache. Uses git ls-files when possible, falls back to walkDir.
 */
async function refreshCache(cwd: string): Promise<void> {
  if (isRefreshing) return
  isRefreshing = true

  try {
    const gitFiles = await getGitFiles(cwd)

    if (gitFiles !== null) {
      cachedFiles = gitFiles
      cachedDirs = extractDirectories(gitFiles)
      cachedCwd = cwd
      lastRefreshMs = Date.now()
      lastGitIndexMtime = getGitIndexMtime(cwd)

      // Background fetch untracked files
      getUntrackedFiles(cwd)
        .then((untracked) => {
          if (untracked.length > 0 && cachedCwd === cwd) {
            const untrackedDirs = extractDirectories(untracked)
            cachedFiles = [...new Set([...cachedFiles, ...untracked])]
            cachedDirs = [...new Set([...cachedDirs, ...untrackedDirs])]
          }
        })
        .catch(() => {})

      return
    }

    // Fallback to walkDir
    cachedFiles = walkDir(cwd, cwd, 0)
    cachedDirs = extractDirectories(cachedFiles)
    cachedCwd = cwd
    lastRefreshMs = Date.now()
  } finally {
    isRefreshing = false
  }
}

/**
 * Check if cache needs refresh based on git state or time
 */
function needsRefresh(cwd: string): boolean {
  if (cwd !== cachedCwd) return true
  if (cachedFiles.length === 0) return true

  // Check git index mtime for tracked file changes
  const currentMtime = getGitIndexMtime(cwd)
  if (currentMtime !== null && currentMtime !== lastGitIndexMtime) return true

  // Time-based fallback for untracked files
  return Date.now() - lastRefreshMs >= REFRESH_THROTTLE_MS
}

/**
 * Get all files (synchronous, returns cached data and triggers async refresh)
 */
export function getFiles(cwd: string): string[] {
  if (needsRefresh(cwd)) {
    // Fire and forget refresh
    refreshCache(cwd).catch((err) => {
      log.warn("File cache refresh failed", { error: String(err) })
    })
  }
  return cachedFiles
}

/** Invalidate the file cache (e.g. after a tool creates files) */
export function invalidateFileCache(): void {
  lastRefreshMs = 0
  lastGitIndexMtime = null
}

/**
 * Fuzzy match with score -- higher is better.
 * Returns -1 for no match.
 */
export function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  let qi = 0
  let score = 0
  let lastMatchIndex = -1

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      // Bonus for consecutive matches
      if (ti === lastMatchIndex + 1) score += 3
      // Bonus for matching after separator (/, ., -)
      else if (ti === 0 || "/.-_".includes(t[ti - 1] ?? "")) score += 2
      else score += 1

      lastMatchIndex = ti
      qi++
    }
  }

  if (qi < q.length) return -1 // No match

  // Bonus for shorter paths (more specific)
  score -= target.length * 0.01
  // Bonus for substring match
  if (t.includes(q)) score += 5
  // Bonus for basename match
  const basename = target.split("/").pop() ?? target
  if (basename.toLowerCase().includes(q)) score += 3

  return score
}

/**
 * Find longest common prefix among a list of strings.
 * Used for tab completion: fill the shared prefix before requiring a pick.
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

/**
 * Search files using fuzzy scoring. Returns up to `limit` results sorted by score.
 * Includes both files and directory entries for directory completion.
 */
export function searchFiles(
  query: string,
  cwd: string,
  limit = MAX_SUGGESTIONS,
): string[] {
  const files = getFiles(cwd)
  const allEntries =
    cachedDirs.length > 0 ? [...files, ...cachedDirs] : files

  if (!query) return allEntries.slice(0, limit)

  // Cap the number of candidates to prevent expensive O(n) fuzzy matching
  const candidates =
    allEntries.length > MAX_FUZZY_CANDIDATES
      ? allEntries.slice(0, MAX_FUZZY_CANDIDATES)
      : allEntries

  const scored: Array<{ path: string; score: number }> = []
  for (const path of candidates) {
    const score = fuzzyScore(query, path)
    if (score >= 0) {
      scored.push({ path, score })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((s) => s.path)
}
