/**
 * Shared file-reading utilities for agent adapters.
 * Shared JSONL reader helpers.
 */
import { readFileSync, statSync, createReadStream } from 'node:fs'
import { readdirSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
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

// ── Async, event-loop-friendly variants ─────────────────────────────────────
// The session-log scan runs in the Electron MAIN process. The synchronous
// versions above block the event loop (and thus all IPC + the UI) for the whole
// walk — with thousands of agent log files that freezes the app. These async
// variants use fs/promises and yield to the event loop periodically so IPC stays
// responsive while the scan proceeds.

/** Yield to the event loop so pending IPC/microtasks can run. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/** Async read of a JSONL file into (lineIndex, rawLine) pairs for non-empty lines. */
export async function readJsonLinesAsync(filePath: string): Promise<Array<[number, string]>> {
  const text = await readFile(filePath, 'utf8')
  const result: Array<[number, string]> = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.length > 0) result.push([i, line])
  }
  return result
}

/**
 * 流式逐行读 JSONL —— 用 createReadStream + readline，避免把整个文件读进一个字符串。
 *
 * 为什么需要：codex 历史 rollout 单文件可达 600MB+，`readFile(utf8)` 会超出 V8 字符串
 * 上限（~536MB）直接抛错，被上层 try/catch 当作"损坏文件"整文件跳过，造成历史用量大面积丢失。
 * 流式读不受此限，内存恒定。
 *
 * yields `[行号(0 基，含空行计数，与 split('\n') 口径一致), trim 后的非空行]`。
 * 每 yield ~5000 行让出一次事件循环，避免在超大文件上长时间阻塞 Electron 主进程。
 */
export async function* readJsonLinesIter(
  filePath: string,
): AsyncGenerator<[number, string], void, void> {
  const stream = createReadStream(filePath, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  let index = -1
  let sinceYield = 0
  try {
    for await (const rawLine of rl) {
      index++
      const line = rawLine.trim()
      if (line.length === 0) continue
      yield [index, line]
      if (++sinceYield >= 5000) {
        sinceYield = 0
        await new Promise((r) => setImmediate(r))
      }
    }
  } finally {
    rl.close()
    stream.destroy()
  }
}

/** Async read of a whole text file. */
export async function readTextAsync(filePath: string): Promise<string> {
  return readFile(filePath, 'utf8')
}

/** Async file mtime as Unix seconds; `fallback` on error. */
export async function fileUpdatedAtAsync(filePath: string, fallback: number): Promise<number> {
  try {
    const s = await stat(filePath)
    return Math.floor(s.mtimeMs / 1000)
  } catch {
    return fallback
  }
}

/** Async file mtime in integer milliseconds; 0 on error. 用于 per-file 增量游标比对。 */
export async function fileMtimeMsAsync(filePath: string): Promise<number> {
  try {
    const s = await stat(filePath)
    return Math.floor(s.mtimeMs)
  } catch {
    return 0
  }
}

/**
 * Async recursive collect, yielding to the event loop between directory entries
 * so a large tree never blocks the UI.
 */
export async function collectMatchingFilesAsync(
  dir: string,
  recursive: boolean,
  predicate: (filePath: string) => boolean,
): Promise<string[]> {
  const results: string[] = []
  let names: string[]
  try {
    names = (await readdir(dir)) as string[]
  } catch {
    return results
  }
  let processed = 0
  for (const name of names) {
    const full = join(dir, name)
    let isDir = false
    let isFile = false
    try {
      const st = await stat(full)
      isDir = st.isDirectory()
      isFile = st.isFile()
    } catch {
      continue
    }
    if (isDir) {
      if (recursive) {
        results.push(...(await collectMatchingFilesAsync(full, recursive, predicate)))
      }
    } else if (isFile && predicate(full)) {
      results.push(full)
    }
    // Yield every 64 entries to keep the event loop responsive.
    if (++processed % 64 === 0) await yieldToEventLoop()
  }
  return results
}
