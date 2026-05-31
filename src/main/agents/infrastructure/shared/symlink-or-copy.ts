// Directory sync (symlink-or-copy) — mirrors Rust
// agents::infrastructure::shared::symlink_or_copy.
//
// Auto: try a directory symlink first, fall back to a recursive copy on failure
// (notably Windows EPERM when Developer Mode is off — documented porting risk).
// The target is always removed first so the sync is a clean replace.

import {
  existsSync,
  rmSync,
  mkdirSync,
  symlinkSync,
  readdirSync,
  statSync,
  copyFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { AgentError } from '../../domain/agent-error'
import type { SyncMethod } from '../../domain/skills-sync'

/** Sync `source` dir → `target` dir using `method`; returns the method actually used. */
export function syncDir(source: string, target: string, method: SyncMethod): SyncMethod {
  switch (method) {
    case 'symlink':
      symlinkDir(source, target)
      return 'symlink'
    case 'copy':
      copyDir(source, target)
      return 'copy'
    case 'auto':
      try {
        symlinkDir(source, target)
        return 'symlink'
      } catch {
        copyDir(source, target)
        return 'copy'
      }
  }
}

function symlinkDir(source: string, target: string): void {
  if (existsSync(target)) {
    try {
      rmSync(target, { recursive: true, force: true })
    } catch (e) {
      throw AgentError.filesystem(target, e)
    }
  }
  const parent = dirname(target)
  try {
    mkdirSync(parent, { recursive: true })
  } catch (e) {
    throw AgentError.filesystem(parent, e)
  }
  try {
    // On Windows, dir symlinks need privileges; 'junction' avoids that but only
    // works for absolute targets. Use 'junction' on win32, 'dir' elsewhere.
    const type = process.platform === 'win32' ? 'junction' : 'dir'
    symlinkSync(source, target, type)
  } catch (e) {
    if (process.platform === 'win32') {
      throw AgentError.symlinkUnsupported(`Windows symlink failed: ${errText(e)}`)
    }
    throw AgentError.filesystem(target, e)
  }
}

function copyDir(source: string, target: string): void {
  if (existsSync(target)) {
    try {
      rmSync(target, { recursive: true, force: true })
    } catch (e) {
      throw AgentError.filesystem(target, e)
    }
  }
  copyDirRecursive(source, target)
}

function copyDirRecursive(src: string, dst: string): void {
  try {
    mkdirSync(dst, { recursive: true })
  } catch (e) {
    throw AgentError.filesystem(dst, e)
  }
  let names: string[]
  try {
    names = readdirSync(src)
  } catch (e) {
    throw AgentError.filesystem(src, e)
  }
  for (const name of names) {
    const srcPath = join(src, name)
    const dstPath = join(dst, name)
    let isDir = false
    try {
      isDir = statSync(srcPath).isDirectory()
    } catch (e) {
      throw AgentError.filesystem(srcPath, e)
    }
    if (isDir) {
      copyDirRecursive(srcPath, dstPath)
    } else {
      try {
        copyFileSync(srcPath, dstPath)
      } catch (e) {
        throw AgentError.filesystem(srcPath, e)
      }
    }
  }
}

/** Shallow count of entries in `dir` (mirrors Rust count_files). 0 if unreadable. */
export function countFiles(dir: string): number {
  try {
    return readdirSync(dir).length
  } catch {
    return 0
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
