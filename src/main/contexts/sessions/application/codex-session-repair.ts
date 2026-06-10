import { readFile } from 'node:fs/promises'
import { findCodexStateDb, CodexStateDb } from '../infrastructure/codex-state-db'
import { rewriteRolloutProvider } from '../infrastructure/codex-rollout-rewrite'
import { CodexRepairBackup, type RolloutBackupEntry } from '../infrastructure/codex-repair-backup'
import { parseCodexToml, getCodexDefaultProvider } from '../../clientConfig/infrastructure/codex-toml'
import type { CodexRepairPreview, CodexRepairRequest, CodexRepairResult } from '../domain/codex-repair'

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

  async repair(req: CodexRepairRequest): Promise<CodexRepairResult> {
    const dbPath = findCodexStateDb(this.codexHome)
    if (!dbPath) throw new Error('未找到 Codex 会话库(state_*.sqlite)')

    // 停 Codex(运行中会并发写 SQLite,损坏风险)。停不掉会抛错中止。
    const token = await this.lifecycle.beforeWrite()
    try {
      // 先读出将改写的 rollout 引用(用于备份清单 + 改写),再动 SQLite。
      const refs = (() => {
        const ro = new CodexStateDb(dbPath, { readonly: true })
        try {
          return req.rewriteRollout ? ro.listRefs(req.targetProvider, req.fromProviders) : []
        } finally {
          ro.close()
        }
      })()

      const rolloutEntries: RolloutBackupEntry[] = refs.map((r) => ({ path: r.rolloutPath, oldProvider: r.provider }))
      const backupId = await this.backup.capture(dbPath, rolloutEntries)

      // SQLite 更新(事务内单条 UPDATE)。
      let updatedThreads = 0
      const db = new CodexStateDb(dbPath)
      try {
        updatedThreads = db.updateProvider(req.targetProvider, req.fromProviders)
      } finally {
        db.close()
      }

      // rollout 改写(逐文件原子写,失败跳过计数,不中断)。
      let rewrittenRollouts = 0
      let skippedRollouts = 0
      if (req.rewriteRollout) {
        for (const ref of refs) {
          const r = await rewriteRolloutProvider(ref.rolloutPath, req.targetProvider)
          if (r.ok) rewrittenRollouts++
          else skippedRollouts++
        }
      }

      return { updatedThreads, rewrittenRollouts, skippedRollouts, backupId }
    } finally {
      await this.lifecycle.afterWrite(token)
    }
  }

  async rollback(backupId: string): Promise<void> {
    const manifest = await this.backup.readManifest(backupId)
    const token = await this.lifecycle.beforeWrite()
    try {
      await this.backup.restoreDbOnly(backupId, manifest.dbPath)
      for (const entry of manifest.rollout) {
        if (entry.oldProvider) await rewriteRolloutProvider(entry.path, entry.oldProvider)
      }
    } finally {
      await this.lifecycle.afterWrite(token)
    }
  }
}
