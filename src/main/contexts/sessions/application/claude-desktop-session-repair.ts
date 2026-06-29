import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type {
  ClaudeDesktopNamespaceSummary,
  ClaudeDesktopRepairPreview,
  ClaudeDesktopRepairRequest,
  ClaudeDesktopRepairResult,
} from '../domain/claude-desktop-repair'

interface BackupManifest {
  id: string
  tsMs: number
  targetNamespace: string
  sourceNamespaces: string[]
  copiedPaths: string[]
}

interface LocalFile {
  path: string
  name: string
  mtimeMs: number
}

interface NamespaceScan {
  key: string
  accountId: string
  workspaceId: string
  files: LocalFile[]
}

export class ClaudeDesktopSessionRepair {
  private readonly appDataDir: string
  private readonly codeSessionsDir: string
  private readonly localAgentDir: string
  private readonly backupDir: string
  private readonly isDesktopRunning: () => Promise<boolean>

  constructor(
    appDataDir: string,
    backupDir: string,
    isDesktopRunning: () => Promise<boolean>,
  ) {
    this.appDataDir = appDataDir
    this.codeSessionsDir = join(appDataDir, 'claude-code-sessions')
    this.localAgentDir = join(appDataDir, 'local-agent-mode-sessions')
    this.backupDir = backupDir
    this.isDesktopRunning = isDesktopRunning
  }

  async preview(): Promise<ClaudeDesktopRepairPreview> {
    const [codeScans, localAgentTouchedAt, desktopRunning] = await Promise.all([
      scanCodeNamespaces(this.codeSessionsDir),
      scanLocalAgentNamespaces(this.localAgentDir),
      this.isDesktopRunning(),
    ])
    const summaries = summarizeNamespaces(codeScans, localAgentTouchedAt)
    const currentNamespace = chooseCurrentNamespace(summaries)
    const sourceNamespaces: ClaudeDesktopNamespaceSummary[] = []
    if (currentNamespace !== undefined) {
      for (const ns of summaries) {
        const hasCodeSource = ns.key !== currentNamespace.key && ns.codeSessionCount > 0
        const hasLegacySource = (await listLocalFiles(namespaceDir(this.localAgentDir, ns.key))).length > 0
        if (hasCodeSource || hasLegacySource) sourceNamespaces.push(ns)
      }
    }
    const repairable = currentNamespace === undefined
      ? 0
      : await this.countRepairable(currentNamespace.key, sourceNamespaces.map((n) => n.key))

    return {
      available: currentNamespace !== undefined,
      appDataDir: this.appDataDir,
      codeSessionsDir: this.codeSessionsDir,
      namespaces: summaries,
      ...(currentNamespace !== undefined ? { currentNamespace } : {}),
      sourceNamespaces,
      repairable,
      desktopRunning,
    }
  }

  async repair(req: ClaudeDesktopRepairRequest = {}): Promise<ClaudeDesktopRepairResult> {
    const pv = await this.preview()
    const targetNamespace = req.targetNamespace ?? pv.currentNamespace?.key
    if (targetNamespace === undefined) throw new Error('未找到 Claude Desktop 当前会话空间')
    const sourceNamespaces = req.sourceNamespaces ?? pv.sourceNamespaces.map((n) => n.key)
    if (sourceNamespaces.length === 0) throw new Error('未找到可迁移的旧会话空间')

    const targetDir = namespaceDir(this.codeSessionsDir, targetNamespace)
    await mkdir(targetDir, { recursive: true })

    const existing = new Set(await listLocalNames(targetDir))
    const copiedPaths: string[] = []
    let copied = 0
    let skippedExisting = 0

    const backupId = await this.writeBackup({
      targetNamespace,
      sourceNamespaces,
      copiedPaths,
    })

    try {
      for (const sourceNamespace of sourceNamespaces) {
        const files = await listRepairSourceFiles(this.codeSessionsDir, this.localAgentDir, sourceNamespace, targetNamespace)
        for (const file of files) {
          if (existing.has(file.name)) {
            skippedExisting++
            continue
          }
          const dest = join(targetDir, file.name)
          await copyFile(file.path, dest)
          const mtime = new Date(file.mtimeMs)
          await utimes(dest, mtime, mtime)
          existing.add(file.name)
          copiedPaths.push(dest)
          copied++
        }
      }
      await this.writeBackup({
        id: backupId,
        targetNamespace,
        sourceNamespaces,
        copiedPaths,
      })
    } catch (err) {
      await removeCopied(copiedPaths)
      throw err
    }

    return { copied, skippedExisting, backupId, targetNamespace, sourceNamespaces }
  }

  async rollback(backupId: string): Promise<void> {
    const manifest = await this.readBackup(backupId)
    await removeCopied(manifest.copiedPaths)
  }

  private async countRepairable(targetNamespace: string, sourceNamespaces: string[]): Promise<number> {
    const targetNames = new Set(await listLocalNames(namespaceDir(this.codeSessionsDir, targetNamespace)))
    const missing = new Set<string>()
    for (const ns of sourceNamespaces) {
      const files = await listRepairSourceFiles(this.codeSessionsDir, this.localAgentDir, ns, targetNamespace)
      for (const file of files) {
        if (!targetNames.has(file.name)) missing.add(file.name)
      }
    }
    return missing.size
  }

  private async writeBackup(input: {
    id?: string
    targetNamespace: string
    sourceNamespaces: string[]
    copiedPaths: string[]
  }): Promise<string> {
    const id = input.id ?? randomUUID()
    const manifest: BackupManifest = {
      id,
      tsMs: Date.now(),
      targetNamespace: input.targetNamespace,
      sourceNamespaces: input.sourceNamespaces,
      copiedPaths: input.copiedPaths,
    }
    await mkdir(this.backupDir, { recursive: true })
    await writeFile(this.backupPath(id), JSON.stringify(manifest, null, 2), 'utf8')
    return id
  }

  private async readBackup(id: string): Promise<BackupManifest> {
    return JSON.parse(await readFile(this.backupPath(id), 'utf8')) as BackupManifest
  }

  private backupPath(id: string): string {
    return join(this.backupDir, `${id}.json`)
  }
}

async function scanCodeNamespaces(root: string): Promise<NamespaceScan[]> {
  const out: NamespaceScan[] = []
  for (const ns of await listNamespaceKeys(root)) {
    out.push({
      ...splitNamespace(ns),
      files: await listLocalFiles(namespaceDir(root, ns)),
    })
  }
  return out
}

async function scanLocalAgentNamespaces(root: string): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (const ns of await listNamespaceKeys(root)) {
    const dir = namespaceDir(root, ns)
    let touchedAt = 0
    try {
      touchedAt = (await stat(dir)).mtimeMs
    } catch {
      touchedAt = 0
    }
    out.set(ns, touchedAt)
  }
  return out
}

function summarizeNamespaces(
  codeScans: NamespaceScan[],
  localAgentTouchedAt: Map<string, number>,
): ClaudeDesktopNamespaceSummary[] {
  const byKey = new Map<string, ClaudeDesktopNamespaceSummary>()
  for (const scan of codeScans) {
    const latest = scan.files.reduce((max, f) => Math.max(max, f.mtimeMs), 0)
    byKey.set(scan.key, {
      key: scan.key,
      accountId: scan.accountId,
      workspaceId: scan.workspaceId,
      codeSessionCount: scan.files.length,
      ...(latest > 0 ? { latestCodeSessionAt: latest } : {}),
    })
  }
  for (const [key, touchedAt] of localAgentTouchedAt) {
    const existing = byKey.get(key)
    if (existing !== undefined) {
      if (touchedAt > 0) existing.localAgentTouchedAt = touchedAt
      continue
    }
    byKey.set(key, {
      ...splitNamespace(key),
      codeSessionCount: 0,
      ...(touchedAt > 0 ? { localAgentTouchedAt: touchedAt } : {}),
    })
  }
  return [...byKey.values()].sort((a, b) => namespaceTime(b) - namespaceTime(a))
}

function chooseCurrentNamespace(
  namespaces: ClaudeDesktopNamespaceSummary[],
): ClaudeDesktopNamespaceSummary | undefined {
  return namespaces.find((ns) => ns.codeSessionCount > 0) ?? namespaces[0]
}

function namespaceTime(ns: ClaudeDesktopNamespaceSummary): number {
  return Math.max(ns.latestCodeSessionAt ?? 0, ns.localAgentTouchedAt ?? 0)
}

async function listNamespaceKeys(root: string): Promise<string[]> {
  const keys: string[] = []
  let accounts: string[]
  try {
    accounts = await readdir(root)
  } catch {
    return keys
  }
  for (const accountId of accounts) {
    const accountDir = join(root, accountId)
    if (!(await isDirectory(accountDir))) continue
    let workspaces: string[]
    try {
      workspaces = await readdir(accountDir)
    } catch {
      continue
    }
    for (const workspaceId of workspaces) {
      const workspaceDir = join(accountDir, workspaceId)
      if (await isDirectory(workspaceDir)) keys.push(`${accountId}/${workspaceId}`)
    }
  }
  return keys
}

async function listLocalFiles(dir: string): Promise<LocalFile[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const files: LocalFile[] = []
  for (const name of names) {
    if (!name.startsWith('local_') || !name.endsWith('.json')) continue
    const path = join(dir, name)
    try {
      const st = await stat(path)
      if (st.isFile()) files.push({ path, name, mtimeMs: st.mtimeMs })
    } catch {
      // 忽略扫描期间被删除的文件
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name))
  return files
}

async function listLocalNames(dir: string): Promise<string[]> {
  return (await listLocalFiles(dir)).map((f) => f.name)
}

async function listRepairSourceFiles(
  codeSessionsDir: string,
  localAgentDir: string,
  sourceNamespace: string,
  targetNamespace: string,
): Promise<LocalFile[]> {
  const byName = new Map<string, LocalFile>()
  const roots = sourceNamespace === targetNamespace
    ? [localAgentDir]
    : [codeSessionsDir, localAgentDir]
  for (const root of roots) {
    const files = await listLocalFiles(namespaceDir(root, sourceNamespace))
    for (const file of files) {
      if (!byName.has(file.name)) byName.set(file.name, file)
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function namespaceDir(root: string, key: string): string {
  const { accountId, workspaceId } = splitNamespace(key)
  return join(root, accountId, workspaceId)
}

function splitNamespace(key: string): { key: string; accountId: string; workspaceId: string } {
  const parts = key.split('/').filter((p) => p.length > 0)
  if (parts.length !== 2) throw new Error(`无效的 Claude Desktop 会话空间: ${key}`)
  return { key: parts.join('/'), accountId: parts[0], workspaceId: parts[1] }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function removeCopied(paths: string[]): Promise<void> {
  for (const path of paths) {
    if (existsSync(path)) {
      try {
        await rm(path, { force: true })
      } catch {
        // 回滚尽力而为；其它文件不受影响
      }
    }
    await removeEmptyParents(path)
  }
}

async function removeEmptyParents(path: string): Promise<void> {
  let dir = dirname(path)
  for (let i = 0; i < 2; i++) {
    try {
      const names = await readdir(dir)
      if (names.length > 0) return
      await rm(dir, { recursive: false, force: true })
      dir = dirname(dir)
    } catch {
      return
    }
  }
}
