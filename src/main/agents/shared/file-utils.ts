/**
 * Shared file-reading utilities for agent adapters.
 * Mirrors the Rust jsonl_reader shared helpers.
 */
import { readFileSync, statSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

/** Compute SHA-256 of a raw string. */
export function rawHash(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

/** Return file mtime as Unix seconds; fallback to `fallback` on error. */
export function fileUpdatedAt(filePath: string, fallback: number): number {
  try {
    const s = statSync(filePath)
    return Math.floor(s.mtimeMs / 1000)
  } catch {
    return fallback
  }
}

/** Parse an RFC-3339 timestamp string to Unix seconds. Returns 0 on failure. */
export function parseRfc3339Timestamp(ts: string): number {
  const ms = Date.parse(ts)
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000)
}

/** Read a text file synchronously. Throws on error. */
export function readText(filePath: string): string {
  return readFileSync(filePath, 'utf8')
}

/**
 * Read a JSONL file and return (lineIndex, rawLine) pairs for non-empty lines.
 * Line index is 0-based (matches Rust enumerate()).
 */
export function readJsonLines(filePath: string): Array<[number, string]> {
  const text = readFileSync(filePath, 'utf8')
  const result: Array<[number, string]> = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.length > 0) {
      result.push([i, line])
    }
  }
  return result
}

/** Return the absolute path string for a file path. */
export function sourcePathStr(filePath: string): string {
  return filePath
}

/** Predicate: is this a .jsonl file? */
export function isJsonlFile(filePath: string): boolean {
  return filePath.endsWith('.jsonl')
}

/**
 * Recursively collect files matching a predicate under `dir`.
 * `recursive` controls whether subdirectories are traversed.
 */
export function collectMatchingFiles(
  dir: string,
  recursive: boolean,
  predicate: (filePath: string) => boolean,
): string[] {
  const results: string[] = []
  let names: string[]
  try {
    names = readdirSync(dir) as string[]
  } catch {
    return results
  }
  for (const name of names) {
    const full = join(dir, name)
    let isDir = false
    let isFile = false
    try {
      const st = statSync(full)
      isDir = st.isDirectory()
      isFile = st.isFile()
    } catch {
      continue
    }
    if (isDir) {
      if (recursive) {
        results.push(...collectMatchingFiles(full, recursive, predicate))
      }
    } else if (isFile && predicate(full)) {
      results.push(full)
    }
  }
  return results
}
