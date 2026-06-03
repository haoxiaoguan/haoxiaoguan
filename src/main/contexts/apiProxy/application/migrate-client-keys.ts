import { createHash } from 'node:crypto'
import type { ApiProxyKeyRepository } from '../infrastructure/api-proxy-key.repository'

/** 一次性迁移：settings 明文 Key → 加密表 + 清 settings。空则 no-op（幂等）。 */
export async function migrateClientKeys(
  plaintextKeys: readonly string[],
  repo: Pick<ApiProxyKeyRepository, 'create' | 'listMeta'>,
  clearSettings: () => void,
): Promise<void> {
  if (plaintextKeys.length === 0) return
  const existing = await repo.listMeta()
  const existingNames = new Set(existing.map((m) => m.name))
  for (const key of plaintextKeys) {
    // 稳定 hash 命名保证幂等：相同明文 key 始终生成相同 name，重复迁移自动跳过。
    const name = `migrated-${createHash('sha256').update(key).digest('hex').slice(0, 8)}`
    if (existingNames.has(name)) continue
    await repo.create(name, key)
  }
  clearSettings()
}
