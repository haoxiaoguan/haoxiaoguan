import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import { dirname, join, resolve, relative, sep } from 'node:path'
import AdmZip from 'adm-zip'
import { SyncError } from '../domain/sync-error'

// Skills archive — deterministic packing + safe extraction of the SSOT skills
// directory. 对应 modules/sync/application/skills_archive.rs.
//
// pack: sorted file names + fixed timestamp + skip hidden files + skip
//   out-of-root symlinks → byte-deterministic zip (so SHA-256 matches across
//   devices for identical content). adm-zip is configured with a fixed entry
//   time to replicate Rust's zip::DateTime::default().
// unpack: path-traversal prevention, entry-count limit (10,000), total-byte
//   limit (512 MB), atomic replace via staging + backup dirs (same volume).

const MAX_EXTRACT_ENTRIES = 10_000
const MAX_EXTRACT_BYTES = 512 * 1024 * 1024

// adm-zip writes DOS time from the entry header `time`. Rust's
// zip::DateTime::default() is 1980-01-01 00:00:00 (the DOS epoch), so we pin the
// same instant for every entry to keep the archive byte-deterministic.
const FIXED_ENTRY_TIME = new Date(1980, 0, 1, 0, 0, 0, 0)

/** Pack `root` deterministically into zip bytes. Missing root → valid empty zip. */
export async function packSkills(root: string): Promise<Buffer> {
  const zip = new AdmZip()

  if (existsSync(root)) {
    const rootCanonical = await fs.realpath(root)
    const files: string[] = []
    await collectFiles(rootCanonical, root, files)
    files.sort()
    for (const abs of files) {
      const rel = relative(root, abs).split(sep).join('/')
      const bytes = await fs.readFile(abs)
      zip.addFile(rel, bytes)
    }
  }

  // Pin a fixed timestamp on every entry for determinism.
  for (const entry of zip.getEntries()) {
    entry.header.time = FIXED_ENTRY_TIME
  }

  return zip.toBuffer()
}

/** Recursively collect regular files, skipping hidden + out-of-root symlinks. */
async function collectFiles(rootCanonical: string, dir: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue
    }
    const path = join(dir, entry.name)
    let canonical: string
    try {
      canonical = await fs.realpath(path)
    } catch {
      // Broken symlink / unreadable — skip (matches source canonicalize failure).
      continue
    }
    // Reject anything that resolves outside the root (symlink escape).
    if (canonical !== rootCanonical && !canonical.startsWith(rootCanonical + sep)) {
      continue
    }
    const stat = await fs.stat(canonical)
    if (stat.isDirectory()) {
      await collectFiles(rootCanonical, path, out)
    } else if (stat.isFile()) {
      out.push(path)
    }
  }
}

/** Safely unpack zip bytes into `root` (staging dir, then atomic replace). */
export async function unpackSkills(root: string, zipBytes: Buffer): Promise<void> {
  return unpackSkillsWithLimits(root, zipBytes, MAX_EXTRACT_ENTRIES, MAX_EXTRACT_BYTES)
}

/** Extraction with parameterized limits (tests inject small values). */
export async function unpackSkillsWithLimits(
  root: string,
  zipBytes: Buffer,
  maxEntries: number,
  maxBytes: number,
): Promise<void> {
  let archive: AdmZip
  try {
    archive = new AdmZip(zipBytes)
  } catch (e) {
    throw SyncError.archive(`zip: ${(e as Error).message}`)
  }
  const entries = archive.getEntries()
  if (entries.length > maxEntries) {
    throw SyncError.archive(`解压超出限制: 条目数 ${entries.length} 超过上限 ${maxEntries}`)
  }

  const parent = dirname(root)
  if (parent === root) {
    throw SyncError.archive('io: root 无父目录')
  }
  await fs.mkdir(parent, { recursive: true })
  const staging = join(parent, '.skills-staging')
  await fs.rm(staging, { recursive: true, force: true })
  await fs.mkdir(staging, { recursive: true })
  const stagingResolved = resolve(staging)

  let totalBytes = 0
  for (const entry of entries) {
    // enclosed_name equivalent: reject path traversal (absolute or `..`).
    const rel = entry.entryName.replace(/\\/g, '/')
    const outPath = resolve(staging, rel)
    if (outPath !== stagingResolved && !outPath.startsWith(stagingResolved + sep)) {
      // Path-traversal entry — skip it (do not write outside staging).
      continue
    }
    if (entry.isDirectory) {
      await fs.mkdir(outPath, { recursive: true })
      continue
    }
    const data = entry.getData()
    totalBytes += data.length
    if (totalBytes > maxBytes) {
      await fs.rm(staging, { recursive: true, force: true })
      throw SyncError.archive(`解压超出限制: 解压字节超过上限 ${maxBytes}`)
    }
    await fs.mkdir(dirname(outPath), { recursive: true })
    await fs.writeFile(outPath, data)
  }

  const backup = join(parent, '.skills-backup')
  await fs.rm(backup, { recursive: true, force: true })
  const hadRoot = existsSync(root)
  if (hadRoot) {
    await fs.rename(root, backup)
  }
  try {
    await fs.rename(staging, root)
    if (hadRoot) {
      await fs.rm(backup, { recursive: true, force: true })
    }
  } catch (e) {
    // Attempt to roll back root; if rollback also fails, the message must make
    // clear the original skills dir may be lost.
    let rollbackFailed = false
    if (hadRoot) {
      try {
        await fs.rename(backup, root)
      } catch {
        rollbackFailed = true
      }
    }
    await fs.rm(staging, { recursive: true, force: true })
    if (rollbackFailed) {
      throw SyncError.archive(
        `io: 替换 root 失败且回滚失败，原 skills 目录可能已丢失（备份在 ${backup}）: ${(e as Error).message}`,
      )
    }
    throw SyncError.archive(`io: 替换 root 失败: ${(e as Error).message}`)
  }
}
