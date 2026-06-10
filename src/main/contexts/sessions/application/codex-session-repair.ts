import { readdir, readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { findCodexStateDb, CodexStateDb } from '../infrastructure/codex-state-db'
import {
  analyzeRollout,
  writeRolloutPreservingMtime,
  rewriteRolloutLines,
} from '../infrastructure/codex-rollout-rewrite'
import { CodexRepairBackup, type SessionMetaBackupEntry } from '../infrastructure/codex-repair-backup'
import { applyGlobalStateUpdate } from '../infrastructure/codex-global-state'
import { parseCodexToml, getCodexDefaultProvider } from '../../clientConfig/infrastructure/codex-toml'
import type {
  CodexRepairPreview,
  CodexRepairProgress,
  CodexRepairRequest,
  CodexRepairResult,
} from '../domain/codex-repair'

const SESSION_DIRS = ['sessions', 'archived_sessions'] as const

/** 停-写-启生命周期最小契约(复用 clientConfig 的 WriteLifecycle 的子集)。 */
export interface RepairLifecycle {
  beforeWrite(): Promise<{ restart: boolean }>
  afterWrite(token: { restart: boolean }): Promise<void>
}

export class CodexSessionRepair {
  private readonly backup: CodexRepairBackup
  constructor(
    private readonly codexHome: string,
    private readonly configTomlPath: string,
    private readonly lifecycle: RepairLifecycle,
    private readonly isCodexRunning: () => Promise<boolean>,
    backupDir: string,
  ) {
    this.backup = new CodexRepairBackup(backupDir)
  }

  private async currentProvider(): Promise<string | undefined> {
    let raw: string | null = null
    try {
      raw = await readFile(this.configTomlPath, 'utf8')
    } catch {
      return undefined
    }
    return getCodexDefaultProvider(parseCodexToml(raw, this.configTomlPath))
  }

  async preview(): Promise<CodexRepairPreview> {
    const dbPath = findCodexStateDb(this.codexHome)
    if (!dbPath) return { available: false, counts: [], repairable: 0, codexRunning: await this.isCodexRunning() }
    const db = new CodexStateDb(dbPath, { readonly: true })
    try {
      if (!db.hasThreadsTable()) {
        return { available: false, dbPath, counts: [], repairable: 0, codexRunning: await this.isCodexRunning() }
      }
      const counts = db.counts()
      const currentProvider = await this.currentProvider()
      const repairable = currentProvider
        ? counts.filter((c) => c.provider !== currentProvider).reduce((a, c) => a + c.count, 0)
        : 0
      return {
        available: true,
        dbPath,
        ...(currentProvider ? { currentProvider } : {}),
        counts,
        repairable,
        codexRunning: await this.isCodexRunning(),
      }
    } finally {
      db.close()
    }
  }

  async repair(req: CodexRepairRequest, onProgress?: (p: CodexRepairProgress) => void): Promise<CodexRepairResult> {
    const dbPath = findCodexStateDb(this.codexHome)
    if (!dbPath) throw new Error('未找到 Codex 会话库(state_*.sqlite)')

    const token = await this.lifecycle.beforeWrite()
    try {
      // ── 1. 扫描 ──────────────────────────────────────────────────────────
      const rolloutFiles = await this.collectRolloutFiles()
      const total = rolloutFiles.length

      interface ChangedFile {
        path: string
        nextText: string
        originalSessionMetaLines: string[]
      }
      const changed: ChangedFile[] = []
      const userEventThreadIds: string[] = []
      const cwdByThreadId: Record<string, string> = {}

      for (let i = 0; i < total; i++) {
        const filePath = rolloutFiles[i]
        let text: string
        try {
          text = await readFile(filePath, 'utf8')
        } catch {
          continue
        }
        const analysis = analyzeRollout(text, req.targetProvider)
        if (analysis.sessionMetaCount === 0) {
          // report progress
          if (i % 20 === 0 || i === total - 1) {
            onProgress?.({
              phase: 'scan',
              percent: total > 0 ? Math.round((i + 1) / total * 40) : 40,
              message: '扫描会话文件',
              current: i + 1,
              total,
            })
          }
          continue
        }
        if (analysis.rewriteNeeded) {
          changed.push({
            path: filePath,
            nextText: analysis.nextText,
            originalSessionMetaLines: analysis.originalSessionMetaLines,
          })
        }
        if (analysis.hasUserEvent && analysis.threadId) {
          userEventThreadIds.push(analysis.threadId)
        }
        if (analysis.threadId && analysis.cwd) {
          cwdByThreadId[analysis.threadId] = analysis.cwd
        }
        if (i % 20 === 0 || i === total - 1) {
          onProgress?.({
            phase: 'scan',
            percent: total > 0 ? Math.round((i + 1) / total * 40) : 40,
            message: '扫描会话文件',
            current: i + 1,
            total,
          })
        }
      }

      // final scan progress if no files
      if (total === 0) {
        onProgress?.({ phase: 'scan', percent: 40, message: '扫描会话文件', current: 0, total: 0 })
      }

      // ── 2. 备份 ──────────────────────────────────────────────────────────
      const backupEntries: SessionMetaBackupEntry[] = changed.map((c) => ({
        path: c.path,
        originalSessionMetaLines: c.originalSessionMetaLines,
      }))
      const backupId = await this.backup.capture(this.codexHome, dbPath, backupEntries)
      onProgress?.({ phase: 'backup', percent: 42, message: '备份中…' })

      // ── 3. 改写 rollout ──────────────────────────────────────────────────
      let changedRollouts = 0
      let skippedRollouts = 0
      const writtenPaths: string[] = []

      if (req.rewriteRollout !== false) {
        const changedTotal = changed.length
        for (let i = 0; i < changed.length; i++) {
          const c = changed[i]
          try {
            await writeRolloutPreservingMtime(c.path, c.nextText)
            writtenPaths.push(c.path)
            changedRollouts++
          } catch (err: unknown) {
            const code = (err as NodeJS.ErrnoException).code
            if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
              skippedRollouts++
            } else {
              skippedRollouts++
            }
          }
          if (i % 20 === 0 || i === changedTotal - 1) {
            onProgress?.({
              phase: 'rollout',
              percent: 42 + (changedTotal > 0 ? Math.round((i + 1) / changedTotal * 46) : 0),
              message: '改写会话文件',
              current: i + 1,
              total: changedTotal,
            })
          }
        }
        if (changed.length === 0) {
          onProgress?.({ phase: 'rollout', percent: 88, message: '改写会话文件', current: 0, total: 0 })
        }
      } else {
        onProgress?.({ phase: 'rollout', percent: 88, message: '改写会话文件（已跳过）' })
      }

      // ── 4. SQLite + 5. global-state (失败时回滚已写 rollout) ─────────────
      let providerRows = 0
      let userEventRows = 0
      let cwdRows = 0
      let globalStateKeys = 0

      try {
        // SQLite
        const db = new CodexStateDb(dbPath)
        try {
          const counts = db.applyUpdates(req.targetProvider, userEventThreadIds, cwdByThreadId)
          providerRows = counts.providerRows
          userEventRows = counts.userEventRows
          cwdRows = counts.cwdRows
        } finally {
          db.close()
        }
        onProgress?.({ phase: 'sqlite', percent: 92, message: '更新数据库索引' })

        // global-state
        const gsPath = join(this.codexHome, '.codex-global-state.json')
        globalStateKeys = await applyGlobalStateUpdate(gsPath)
        onProgress?.({ phase: 'globalstate', percent: 97, message: '整理工作区索引' })
      } catch (err) {
        // 回滚已写 rollout
        for (const p of writtenPaths) {
          const entry = backupEntries.find((e) => e.path === p)
          if (entry) {
            try { await rewriteRolloutLines(p, entry.originalSessionMetaLines) } catch { /* best effort */ }
          }
        }
        // 回滚 db
        try { await this.backup.restoreDbOnly(backupId, dbPath) } catch { /* best effort */ }
        throw err
      }

      await this.backup.prune(5)
      onProgress?.({ phase: 'done', percent: 100, message: '完成' })

      return {
        updatedThreads: providerRows,
        userEventRows,
        cwdRows,
        globalStateKeys,
        changedRollouts,
        skippedRollouts,
        backupId,
      }
    } finally {
      await this.lifecycle.afterWrite(token)
    }
  }

  async rollback(backupId: string): Promise<void> {
    const manifest = await this.backup.readManifest(backupId)
    const token = await this.lifecycle.beforeWrite()
    try {
      await this.backup.restoreDbOnly(backupId, manifest.dbPath)
      await this.backup.restoreConfigAndGlobalState(backupId, manifest.home)
      const entries = await this.backup.readSessionMetaBackup(backupId)
      for (const entry of entries) {
        if (existsSync(entry.path)) {
          try {
            await rewriteRolloutLines(entry.path, entry.originalSessionMetaLines)
          } catch { /* best effort */ }
        }
      }
    } finally {
      await this.lifecycle.afterWrite(token)
    }
  }

  // ── private helpers ───────────────────────────────────────────────────────

  private async collectRolloutFiles(): Promise<string[]> {
    const files: string[] = []
    for (const dir of SESSION_DIRS) {
      const root = join(this.codexHome, dir)
      if (existsSync(root)) {
        await collectRolloutFilesRecursive(root, files)
      }
    }
    files.sort()
    return files
  }
}

async function collectRolloutFilesRecursive(root: string, files: string[]): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return
  }
  for (const name of entries) {
    const p = join(root, name)
    try {
      const st = await stat(p)
      if (st.isDirectory()) {
        await collectRolloutFilesRecursive(p, files)
      } else if (name.startsWith('rollout-') && name.endsWith('.jsonl')) {
        files.push(p)
      }
    } catch {
      // ignore
    }
  }
}
