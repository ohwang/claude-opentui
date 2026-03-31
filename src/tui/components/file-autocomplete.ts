/**
 * File Autocomplete — Directory walker + fuzzy search for @-mention file picker
 *
 * Walks the CWD directory tree (up to 3 levels deep, excluding common noise dirs).
 * Caches the file list with a 30s TTL. Provides searchFiles() for fuzzy matching.
 * Returns paths relative to CWD.
 */

import { readdirSync, statSync } from "fs"
import { join, relative } from "path"

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
])
const MAX_DEPTH = 3
const MAX_FILES = 1000

let cachedFiles: string[] = []
let cachedCwd = ""
let cacheTime = 0
const CACHE_TTL = 30_000 // 30 seconds

function walkDir(dir: string, basePath: string, depth: number): string[] {
  if (depth > MAX_DEPTH) return []
  const results: string[] = []
  try {
    const entries = readdirSync(dir)
    for (const entry of entries) {
      if (entry.startsWith(".") && entry !== ".") continue
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
      if (results.length >= MAX_FILES) break
    }
  } catch {
    /* skip unreadable dirs */
  }
  return results
}

export function getFiles(cwd: string): string[] {
  const now = Date.now()
  if (cwd === cachedCwd && now - cacheTime < CACHE_TTL && cachedFiles.length > 0) {
    return cachedFiles
  }
  cachedFiles = walkDir(cwd, cwd, 0)
  cachedCwd = cwd
  cacheTime = now
  return cachedFiles
}

/** Invalidate the file cache (e.g. after a tool creates files) */
export function invalidateFileCache(): void {
  cacheTime = 0
}

/** Simple fuzzy match: all characters in query appear in order in target */
function fuzzyMatch(query: string, target: string): boolean {
  let qi = 0
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

export function searchFiles(query: string, cwd: string, limit = 12): string[] {
  const files = getFiles(cwd)
  if (!query) return files.slice(0, limit)

  return files
    .filter((f) => fuzzyMatch(query, f))
    .sort((a, b) => {
      const q = query.toLowerCase()
      // Prefer substring matches over pure fuzzy
      const aContains = a.toLowerCase().includes(q) ? 0 : 1
      const bContains = b.toLowerCase().includes(q) ? 0 : 1
      if (aContains !== bContains) return aContains - bContains
      // Then prefer shorter paths (more specific)
      return a.length - b.length
    })
    .slice(0, limit)
}
