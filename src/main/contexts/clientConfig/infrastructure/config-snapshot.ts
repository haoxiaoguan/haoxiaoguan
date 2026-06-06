// 配置快照 / 历史 —— 写客户端配置前对「目标整文件」拍快照，作为回滚地基。
//
// 设计：
//   - 每次写盘（apply/switch/clear）前，把将被改动的全部文件当前内容（不存在记 null）存成一条独立快照。
//   - 快照存为独立 JSON 文件（每客户端一子目录），抗损坏、易增量；FIFO 裁剪到 limit 条。
//   - 回滚（restore）本身**先拍一条当前状态的快照（action='rollback'）再写回**——双向可逆、可多层撤销。
//   - 内容为 null 的文件回滚时删除（还原「当时不存在」的状态）。
import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { atomicWrite } from '../../../platform/fs/atomic-write'
import type { ClientId } from '../domain/client-profile'

export type SnapshotAction = 'apply' | 'switch' | 'clear' | 'rollback'

export interface SnapshotEntry {
  id: string
  clientId: ClientId
  action: SnapshotAction
  tsMs: number
  profileId?: string
  /** 目标文件绝对路径 → 写入前内容（null = 当时文件不存在）。 */
  files: Record<string, string | null>
}

export interface ConfigSnapshotStoreOpts {
  /** 历史根目录（每客户端一子目录）。 */
  baseDir: string
  /** 每客户端保留的最大快照数（FIFO 裁剪）。默认 10。 */
  limit?: number
  clock?: () => number
  genId?: () => string
}

export class ConfigSnapshotStore {
  private readonly baseDir: string
  private readonly limit: number
  private readonly clock: () => number
  private readonly genId: () => string

  constructor(opts: ConfigSnapshotStoreOpts) {
    this.baseDir = opts.baseDir
    this.limit = Math.max(1, opts.limit ?? 10)
    this.clock = opts.clock ?? Date.now
    this.genId = opts.genId ?? randomUUID
  }

  private dirFor(clientId: ClientId): string {
    return join(this.baseDir, clientId)
  }

  /** 读取若干文件当前内容（不存在记 null），存一条历史快照，FIFO 裁剪。返回快照 id。 */
  async capture(
    clientId: ClientId,
    action: SnapshotAction,
    filePaths: string[],
    profileId?: string,
  ): Promise<string> {
    const files: Record<string, string | null> = {}
    for (const p of filePaths) files[p] = await this.readOrNull(p)
    const entry: SnapshotEntry = {
      id: this.genId(),
      clientId,
      action,
      tsMs: this.clock(),
      ...(profileId !== undefined ? { profileId } : {}),
      files,
    }
    const dir = this.dirFor(clientId)
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, `${entry.tsMs}-${entry.id}.json`),
      JSON.stringify(entry, null, 2),
      'utf8',
    )
    await this.prune(clientId)
    return entry.id
  }

  /** 列出某客户端历史快照（按时间倒序，最新在前；跳过损坏条目）。 */
  async list(clientId: ClientId): Promise<SnapshotEntry[]> {
    const dir = this.dirFor(clientId)
    const entries: SnapshotEntry[] = []
    for (const n of await this.safeReaddir(dir)) {
      if (!n.endsWith('.json')) continue
      try {
        entries.push(JSON.parse(await readFile(join(dir, n), 'utf8')) as SnapshotEntry)
      } catch {
        // 跳过损坏条目
      }
    }
    entries.sort((a, b) => b.tsMs - a.tsMs)
    return entries
  }

  /**
   * 回滚到某条快照：先把当前状态再存一条（action='rollback'，使回滚本身可逆），
   * 再把每个文件写回快照内容（内容为 null 则删除该文件）。
   */
  async restore(clientId: ClientId, entryId: string): Promise<void> {
    const target = (await this.list(clientId)).find((e) => e.id === entryId)
    if (target === undefined) throw new Error(`快照不存在: ${entryId}`)
    await this.capture(clientId, 'rollback', Object.keys(target.files), target.profileId)
    for (const [path, content] of Object.entries(target.files)) {
      if (content === null) {
        await this.deleteIfExists(path)
      } else {
        // 回滚是 apply 出错后的最后退路，写回也走原子写（tmp+rename），避免半截损坏。
        await atomicWrite(path, content)
      }
    }
  }

  private async prune(clientId: ClientId): Promise<void> {
    const dir = this.dirFor(clientId)
    // 文件名以 tsMs 前缀，升序排序=最旧在前；超出 limit 删最旧。
    const names = (await this.safeReaddir(dir)).filter((n) => n.endsWith('.json')).sort()
    const excess = names.length - this.limit
    for (let i = 0; i < excess; i++) await this.deleteIfExists(join(dir, names[i]))
  }

  private async readOrNull(p: string): Promise<string | null> {
    try {
      return await readFile(p, 'utf8')
    } catch {
      return null
    }
  }
  private async safeReaddir(dir: string): Promise<string[]> {
    try {
      return await readdir(dir)
    } catch {
      return []
    }
  }
  private async deleteIfExists(p: string): Promise<void> {
    try {
      await unlink(p)
    } catch {
      // 不存在即忽略
    }
  }
}
