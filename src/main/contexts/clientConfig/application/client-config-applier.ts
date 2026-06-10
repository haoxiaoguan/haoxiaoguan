// 应用层编排：把纯渲染写入器接上「读 live → 写前快照 → 原子写」。
// 顺序保证：先计算 next（损坏即抛、不快照不写）→ 再快照 → 再逐文件原子写。
import { readFile } from 'node:fs/promises'
import { atomicWrite } from '../../../platform/fs/atomic-write'
import type { ConfigSnapshotStore, SnapshotAction } from '../infrastructure/config-snapshot'
import type { ClientConfigWriter, ApplyInput, FileBundle } from '../domain/client-writer'

/** 单文件 before/after（供前端双栏 diff 预览）。 */
export interface DiffFile {
  file: string
  before: string | null
  after: string | null
}

async function readBundle(paths: string[]): Promise<FileBundle> {
  const out: FileBundle = {}
  for (const p of paths) {
    try {
      out[p] = await readFile(p, 'utf8')
    } catch {
      out[p] = null
    }
  }
  return out
}

export class ClientConfigApplier {
  private readonly snapshots: ConfigSnapshotStore

  constructor(snapshots: ConfigSnapshotStore) {
    this.snapshots = snapshots
  }

  /** 预览：纯计算 before/after，不写盘、不快照。损坏会抛 ClientConfigCorruptError。 */
  async preview(writer: ClientConfigWriter, input: ApplyInput): Promise<DiffFile[]> {
    const current = await readBundle(writer.configFiles())
    const next = writer.renderApply(current, input)
    return diff(writer.configFiles(), current, next)
  }

  /** 写入接入档（apply/switch 同义；switch 由上层在切换语境调用）。 */
  async apply(writer: ClientConfigWriter, input: ApplyInput, action: SnapshotAction = 'apply'): Promise<void> {
    await this.write(writer, (cur) => writer.renderApply(cur, input), action, input.profileId)
  }

  /** 还原接入档（移除号小管写入的配置）。 */
  async clear(writer: ClientConfigWriter, profileId: string): Promise<void> {
    await this.write(writer, (cur) => writer.renderClear(cur, profileId), 'clear', profileId)
  }

  private async write(
    writer: ClientConfigWriter,
    render: (current: FileBundle) => FileBundle,
    action: SnapshotAction,
    profileId: string,
  ): Promise<void> {
    const current = await readBundle(writer.configFiles())
    const next = render(current) // 先算（损坏即抛，发生在任何进程/快照/写盘之前 → 配置损坏时不会白停 App）
    // 进程生命周期（仅 Codex 桌面 App 挂载）：停 App → 写盘 → 重启 App，
    // 否则运行中的 Codex App 会按内存反写 config.toml 抹掉本次写入。beforeWrite 停不掉会抛错中止。
    const lifecycle = writer.lifecycle
    const token = lifecycle !== undefined ? await lifecycle.beforeWrite() : undefined
    try {
      await this.snapshots.capture(writer.clientId, action, writer.configFiles(), profileId)
      // 多文件（如 Gemini 的 .env + settings.json）写中途失败 → best-effort 把已写文件回滚到
      // 写前内容，避免停在不一致中间态（快照亦留存供手动恢复）。
      const written: string[] = []
      try {
        for (const [path, content] of Object.entries(next)) {
          if (content !== null) {
            await atomicWrite(path, content)
            written.push(path)
          }
        }
      } catch (err) {
        for (const path of written) {
          const prev = current[path]
          if (prev !== null) {
            try {
              await atomicWrite(path, prev)
            } catch {
              // 补偿回滚已尽力；写前快照仍可手动恢复
            }
          }
        }
        throw err
      }
    } finally {
      // 无论写成功或回滚都重启 App，恢复用户的 Codex（仅在 beforeWrite 真停过时才重启）。
      if (lifecycle !== undefined && token !== undefined) await lifecycle.afterWrite(token)
    }
  }
}

function diff(paths: string[], current: FileBundle, next: FileBundle): DiffFile[] {
  return paths.map((file) => ({
    file,
    before: current[file] ?? null,
    after: file in next ? next[file] : (current[file] ?? null),
  }))
}
