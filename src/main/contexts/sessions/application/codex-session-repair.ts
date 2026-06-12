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

  // Codex 当前生效的默认 provider。config.toml 无 model_provider 键（或文件不存在）=
  // Codex 用内置 OpenAI（隐式默认，不写盘），其会话在 threads 里 model_provider='openai'，
  // 故缺省回落 'openai' —— 否则内置 OpenAI 场景下「当前供应商」为空、修复目标无从确定、
  // 可修复恒 0，那些切到第三方时建的 hxg_* 会话永远归并不回 OpenAI。
  private async currentProvider(): Promise<string> {
    let raw: string | null = null
    try {
      raw = await readFile(this.configTomlPath, 'utf8')
    } catch {
      return 'openai'
    }
    return getCodexDefaultProvider(parseCodexToml(raw, this.configTomlPath)) ?? 'openai'
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
      const currentProvider = await this.currentProvider() // 恒有值（缺省内置 openai）
      const repairable = counts
        .filter((c) => c.provider !== currentProvider)
        .reduce((a, c) => a + c.count, 0)
      return {
        available: true,
        dbPath,
        currentProvider,
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

      // 只存轻量信息（路径 + 备份用的 session_meta 原始行）。改写后的完整文件内容(nextText)
      // 不在扫描阶段保留——7000+ 大文件的 nextText 同时驻留主进程会 OOM 崩溃（已实证）。
      interface ChangedFile {
        path: string
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

      // ── 3. 改写 rollout + 4. SQLite + 5. global-state ────────────────────
      // 任一步失败 → 从备份完整回滚(db + config/global-state + 已改 rollout)再抛错,避免停在
      // 「rollout 改了但 SQLite 没改」或「SQLite 改了但 global-state 半写」的不一致中间态。
      let changedRollouts = 0
      let skippedRollouts = 0
      let providerRows = 0
      let userEventRows = 0
      let cwdRows = 0
      let globalStateKeys = 0

      try {
        // 3. 改写 rollout(锁文件跳过计数;其它 IO 错误中止→回滚,对齐 codex++ apply_session_changes)
        if (req.rewriteRollout !== false) {
          const changedTotal = changed.length
          for (let i = 0; i < changedTotal; i++) {
            const c = changed[i]
            // 内存恒定：改写阶段才逐文件重新读取+解析得到 nextText（Codex 已停，内容与扫描时一致），
            // 任意时刻内存只驻留一个文件，避免一次性持有数千份改写后文本导致主进程 OOM。
            let nextText: string
            try {
              const current = await readFile(c.path, 'utf8')
              const reanalysis = analyzeRollout(current, req.targetProvider)
              if (!reanalysis.rewriteNeeded) {
                skippedRollouts++ // 已无需改写（极少见：扫描后内容变化）
                continue
              }
              nextText = reanalysis.nextText
            } catch (err: unknown) {
              const code = (err as NodeJS.ErrnoException).code
              if (code === 'ENOENT') {
                skippedRollouts++ // 扫描后文件被删→跳过
                continue
              }
              throw err // 其它读错误→中止并回滚
            }
            try {
              await writeRolloutPreservingMtime(c.path, nextText)
              changedRollouts++
            } catch (err: unknown) {
              const code = (err as NodeJS.ErrnoException).code
              if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
                skippedRollouts++ // 文件被占用→跳过,不中止
              } else {
                throw err // 其它 IO 错误→中止并回滚
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
          if (changedTotal === 0) {
            onProgress?.({ phase: 'rollout', percent: 88, message: '改写会话文件', current: 0, total: 0 })
          }
        } else {
          onProgress?.({ phase: 'rollout', percent: 88, message: '改写会话文件（已跳过）' })
        }

        // 4. SQLite(单事务:provider 全量 + has_user_event + cwd)
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

        // 5. global-state
        globalStateKeys = await applyGlobalStateUpdate(join(this.codexHome, '.codex-global-state.json'))
        onProgress?.({ phase: 'globalstate', percent: 97, message: '整理工作区索引' })
      } catch (err) {
        // 完整回滚(与 rollback() 同一路径):db + config/global-state + 已改 rollout。
        await this.restoreFromBackup(backupId).catch(() => {})
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
    const token = await this.lifecycle.beforeWrite()
    try {
      await this.restoreFromBackup(backupId)
    } finally {
      await this.lifecycle.afterWrite(token)
    }
  }

  // ── private helpers ───────────────────────────────────────────────────────

  /**
   * 从备份完整回滚:db(含删修复期 live wal/shm)+ config/.codex-global-state(+.bak)
   * + 所有已改 rollout 文件的 session_meta 行。供 repair 失败内联回滚与 rollback() 复用,
   * 保证两条回滚路径一致(opus 复审 I-1/I-2)。调用方负责停-写-启生命周期。
   */
  private async restoreFromBackup(backupId: string): Promise<void> {
    const manifest = await this.backup.readManifest(backupId)
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
  }

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
