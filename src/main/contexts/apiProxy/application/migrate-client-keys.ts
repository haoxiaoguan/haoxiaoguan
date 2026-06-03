import type { ApiProxyKeyRepository } from '../infrastructure/api-proxy-key.repository'

/** 一次性迁移：settings 明文 Key → 加密表 + 清 settings。空则 no-op（幂等）。 */
export async function migrateClientKeys(
  plaintextKeys: readonly string[],
  repo: Pick<ApiProxyKeyRepository, 'create'>,
  clearSettings: () => void,
): Promise<void> {
  if (plaintextKeys.length === 0) return
  let seq = 1
  for (const key of plaintextKeys) {
    await repo.create(`migrated-${seq}`, key)
    seq += 1
  }
  clearSettings()
}
