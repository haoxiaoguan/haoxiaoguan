// JSONL / file-reading helpers — mirrors Rust
// agents::infrastructure::shared::jsonl_reader.
//
// raw_hash: the source uses Rust's DefaultHasher (SipHash-1-3) formatted as a
// 16-char zero-padded hex. That algorithm is not reproducible in Node, so this
// port uses a 64-bit FNV-1a fingerprint rendered as 16-char hex. It is a
// non-cryptographic dedup fingerprint only; values will differ from the Rust
// build (documented porting risk — hashes are not persisted across the rewrite).

import { readFileSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { AgentError } from '../../domain/agent-error'

/** Read a text file. Throws AgentError.filesystem on failure (mirrors Rust read_text). */
export function readText(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8')
  } catch (e) {
    throw AgentError.filesystem(filePath, e)
  }
}

/**
 * Read a JSONL file → array of [lineIndex, rawLine] for non-empty trimmed lines.
 * lineIndex is 0-based (matches Rust .lines().enumerate()).
 */
export function readJsonLines(filePath: string): Array<[number, string]> {
  const content = readText(filePath)
  const result: Array<[number, string]> = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed.length > 0) result.push([i, trimmed])
  }
  return result
}

/**
 * Recursively collect files under `root` matching `predicate`, sorted.
 * Returns [] if root does not exist (mirrors Rust collect_matching_files).
 */
export function collectMatchingFiles(
  root: string,
  recursive: boolean,
  predicate: (filePath: string) => boolean,
): string[] {
  const files: string[] = []
  visit(root, recursive, predicate, files)
  files.sort()
  return files
}

function visit(
  root: string,
  recursive: boolean,
  predicate: (filePath: string) => boolean,
  files: string[],
): void {
  let names: string[]
  try {
    names = readdirSync(root)
  } catch {
    // Non-existent / unreadable dir → nothing to collect (matches Rust early return).
    return
  }
  for (const name of names) {
    const full = join(root, name)
    let isDir = false
    let isFile = false
    try {
      const st = statSync(full)
      isDir = st.isDirectory()
      isFile = st.isFile()
    } catch {
      continue
    }
    if (isFile && predicate(full)) {
      files.push(full)
    } else if (recursive && isDir) {
      visit(full, true, predicate, files)
    }
  }
}

/** Parse an RFC-3339 timestamp to Unix seconds. Throws AgentError.validation on failure. */
export function parseRfc3339Timestamp(timestamp: string): number {
  const ms = Date.parse(timestamp)
  if (Number.isNaN(ms)) {
    throw AgentError.validation(`timestamp parse error: ${timestamp}`)
  }
  return Math.floor(ms / 1000)
}

/** File mtime as Unix seconds; `fallback` on error (mirrors Rust file_updated_at). */
export function fileUpdatedAt(filePath: string, fallback: number): number {
  try {
    return Math.floor(statSync(filePath).mtimeMs / 1000)
  } catch {
    return fallback
  }
}

/** 64-bit FNV-1a fingerprint of `raw`, 16-char zero-padded hex. */
export function rawHash(raw: string): string {
  const FNV_OFFSET = 0xcbf29ce484222325n
  const FNV_PRIME = 0x100000001b3n
  const MASK = 0xffffffffffffffffn
  let hash = FNV_OFFSET
  for (let i = 0; i < raw.length; i++) {
    // Hash the UTF-16 code unit's bytes (low, high) to cover the full BMP range.
    const code = raw.charCodeAt(i)
    hash = ((hash ^ BigInt(code & 0xff)) * FNV_PRIME) & MASK
    hash = ((hash ^ BigInt((code >> 8) & 0xff)) * FNV_PRIME) & MASK
  }
  return hash.toString(16).padStart(16, '0')
}

export function sourcePathStr(filePath: string): string {
  return filePath
}

export function isJsonlFile(filePath: string): boolean {
  return filePath.endsWith('.jsonl')
}
