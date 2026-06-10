// RelayUpstreamRepository 单测（TDD）。
// 使用内存 stub EntityManager（对齐 api-proxy-key-repo.test.ts 范式），禁真 DB。
// 验证：
//   ① create 加密落库，返回 Record 不含明文 key
//   ② list 返回所有记录
//   ③ get 按 id 查找；不存在返回 null
//   ④ update 修改字段；apiKey 有则重新加密
//   ⑤ delete 移除
//   ⑥ resolveApiKey 解密回得来明文（真 CryptoService）
//   ⑦ models JSON 往返
//   ⑧ update 不存在 id 返回 null
import { describe, it, expect } from 'vitest'
import { RelayUpstreamRepository } from '../../../src/main/contexts/apiProxy/infrastructure/relay/relay-upstream.repository'
import { CryptoService } from '../../../src/main/platform/crypto/crypto-service'
import { RelayUpstreamEntity } from '../../../src/main/contexts/apiProxy/infrastructure/relay/relay-upstream.entity'

// 内存 stub EntityManager：仅实现 repo 用到的方法
function makeStubEm() {
  const rows: RelayUpstreamEntity[] = []
  return {
    rows,
    em: {
      async find(_e: unknown, _where?: unknown) {
        return [...rows]
      },
      async findOne(_e: unknown, where: { id: string }) {
        return rows.find((r) => r.id === where.id) ?? null
      },
      persist(entity: RelayUpstreamEntity) {
        rows.push(entity)
      },
      async flush() { /* no-op */ },
      async nativeDelete(_e: unknown, where: { id: string }) {
        const i = rows.findIndex((r) => r.id === where.id)
        if (i >= 0) rows.splice(i, 1)
        return 1
      },
    },
  }
}

const crypto = new CryptoService(Buffer.alloc(32, 7)) // 测试 master key

describe('RelayUpstreamRepository', () => {
  it('create 加密落库，返回 Record 不含明文 apiKey', async () => {
    const { em, rows } = makeStubEm()
    const repo = new RelayUpstreamRepository(crypto, () => em as never)

    const rec = await repo.create({
      displayName: 'DeepSeek',
      protocol: 'openai',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-deepseek-secret-key-12345',
    })

    expect(rec.displayName).toBe('DeepSeek')
    expect(rec.protocol).toBe('openai')
    expect(rec.baseUrl).toBe('https://api.deepseek.com/v1')
    expect(rec.enabled).toBe(true)
    expect(rec.id).toBeTruthy()
    expect(rows).toHaveLength(1)

    // 落库的 keyEnc 不含明文
    expect(rows[0].keyEnc).not.toContain('sk-deepseek-secret-key-12345')
    // 对外 record 不含明文
    expect((rec as Record<string, unknown>).apiKey).toBeUndefined()
    expect((rec as Record<string, unknown>).keyEnc).toBeUndefined()
  })

  it('list 返回所有记录', async () => {
    const { em } = makeStubEm()
    const repo = new RelayUpstreamRepository(crypto, () => em as never)

    await repo.create({ displayName: 'A', protocol: 'openai', baseUrl: 'https://a.com', apiKey: 'key-a' })
    await repo.create({ displayName: 'B', protocol: 'anthropic', baseUrl: 'https://b.com', apiKey: 'key-b' })

    const list = await repo.list()
    expect(list).toHaveLength(2)
    expect(list.map((r) => r.displayName).sort()).toEqual(['A', 'B'])
  })

  it('get 按 id 查找；不存在返回 null', async () => {
    const { em } = makeStubEm()
    const repo = new RelayUpstreamRepository(crypto, () => em as never)

    const rec = await repo.create({ displayName: 'Test', protocol: 'openai', baseUrl: 'https://t.com', apiKey: 'key-t' })

    const found = await repo.get(rec.id)
    expect(found).not.toBeNull()
    expect(found!.displayName).toBe('Test')

    const missing = await repo.get('non-existent-id')
    expect(missing).toBeNull()
  })

  it('update 修改字段', async () => {
    const { em } = makeStubEm()
    const repo = new RelayUpstreamRepository(crypto, () => em as never)

    const rec = await repo.create({ displayName: 'Old', protocol: 'openai', baseUrl: 'https://old.com', apiKey: 'key-old' })
    const updated = await repo.update(rec.id, { displayName: 'New', baseUrl: 'https://new.com', enabled: false })

    expect(updated).not.toBeNull()
    expect(updated!.displayName).toBe('New')
    expect(updated!.baseUrl).toBe('https://new.com')
    expect(updated!.enabled).toBe(false)
    expect(updated!.protocol).toBe('openai') // 未改
  })

  it('update apiKey 重新加密，resolveApiKey 得新值', async () => {
    const { em } = makeStubEm()
    const repo = new RelayUpstreamRepository(crypto, () => em as never)

    const rec = await repo.create({ displayName: 'X', protocol: 'openai', baseUrl: 'https://x.com', apiKey: 'key-old' })
    await repo.update(rec.id, { apiKey: 'key-new' })

    const plain = await repo.resolveApiKey(rec.id)
    expect(plain).toBe('key-new')
  })

  it('update 不存在 id 返回 null', async () => {
    const { em } = makeStubEm()
    const repo = new RelayUpstreamRepository(crypto, () => em as never)

    const result = await repo.update('no-such-id', { displayName: 'X' })
    expect(result).toBeNull()
  })

  it('delete 移除记录', async () => {
    const { em, rows } = makeStubEm()
    const repo = new RelayUpstreamRepository(crypto, () => em as never)

    const rec = await repo.create({ displayName: 'D', protocol: 'openai', baseUrl: 'https://d.com', apiKey: 'key-d' })
    expect(rows).toHaveLength(1)

    await repo.delete(rec.id)
    expect(rows).toHaveLength(0)
  })

  it('resolveApiKey 解密回得来明文', async () => {
    const { em } = makeStubEm()
    const repo = new RelayUpstreamRepository(crypto, () => em as never)

    const rec = await repo.create({ displayName: 'Enc', protocol: 'anthropic', baseUrl: 'https://enc.com', apiKey: 'super-secret-key-789' })
    const plain = await repo.resolveApiKey(rec.id)
    expect(plain).toBe('super-secret-key-789')
  })

  it('resolveApiKey 不存在 id 抛出错误', async () => {
    const { em } = makeStubEm()
    const repo = new RelayUpstreamRepository(crypto, () => em as never)

    await expect(repo.resolveApiKey('ghost-id')).rejects.toThrow('relay upstream not found: ghost-id')
  })

  it('models JSON 往返：create 存入 models，list 取回一致', async () => {
    const { em } = makeStubEm()
    const repo = new RelayUpstreamRepository(crypto, () => em as never)

    const models = [
      { id: 'deepseek-chat', displayName: 'DeepSeek Chat', contextLength: 65536 },
      { id: 'deepseek-coder', displayName: 'DeepSeek Coder' },
    ]

    const rec = await repo.create({
      displayName: 'DS',
      protocol: 'openai',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'key',
      models,
    })

    expect(rec.models).toEqual(models)

    const found = await repo.get(rec.id)
    expect(found!.models).toEqual(models)
  })

  it('models 为空时返回空数组', async () => {
    const { em } = makeStubEm()
    const repo = new RelayUpstreamRepository(crypto, () => em as never)

    const rec = await repo.create({ displayName: 'Empty', protocol: 'openai', baseUrl: 'https://e.com', apiKey: 'k' })
    expect(rec.models).toEqual([])
  })

  it('enabled 默认 true；可通过 create 设为 false', async () => {
    const { em } = makeStubEm()
    const repo = new RelayUpstreamRepository(crypto, () => em as never)

    const enabled = await repo.create({ displayName: 'E', protocol: 'openai', baseUrl: 'https://e.com', apiKey: 'k' })
    expect(enabled.enabled).toBe(true)

    const disabled = await repo.create({ displayName: 'D', protocol: 'openai', baseUrl: 'https://d.com', apiKey: 'k', enabled: false })
    expect(disabled.enabled).toBe(false)
  })
})

describe('RelayUpstreamRepository - profileId 方法', () => {
  // stub em 支持 findOne by profileId
  function makeStubEmWithProfileId() {
    const rows: (RelayUpstreamEntity & { profileId: string | null })[] = []
    return {
      rows,
      em: {
        async find(_e: unknown, _where?: unknown) {
          return [...rows]
        },
        async findOne(_e: unknown, where: { id?: string; profileId?: string }) {
          if (where.id !== undefined) return rows.find((r) => r.id === where.id) ?? null
          if (where.profileId !== undefined) return rows.find((r) => r.profileId === where.profileId) ?? null
          return null
        },
        persist(entity: RelayUpstreamEntity) {
          rows.push(entity as RelayUpstreamEntity & { profileId: string | null })
        },
        async flush() { /* no-op */ },
        async nativeDelete(_e: unknown, where: { id?: string; profileId?: string }) {
          if (where.id !== undefined) {
            const i = rows.findIndex((r) => r.id === where.id)
            if (i >= 0) rows.splice(i, 1)
          } else if (where.profileId !== undefined) {
            const i = rows.findIndex((r) => r.profileId === where.profileId)
            if (i >= 0) rows.splice(i, 1)
          }
          return 1
        },
      },
    }
  }

  it('upsertByProfileId 不存在时新建，profileId 持久化往返', async () => {
    const { em, rows } = makeStubEmWithProfileId()
    const repo = new RelayUpstreamRepository(crypto, () => em as never)

    const rec = await repo.upsertByProfileId('profile-abc', {
      displayName: 'DeepSeek',
      protocol: 'openai',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test',
    })

    expect(rec.id).toBeTruthy()
    expect(rec.displayName).toBe('DeepSeek')
    expect(rec.profileId).toBe('profile-abc')
    expect(rows).toHaveLength(1)
    expect(rows[0].profileId).toBe('profile-abc')
  })

  it('upsertByProfileId 已存在时更新字段，id 不变', async () => {
    const { em } = makeStubEmWithProfileId()
    const repo = new RelayUpstreamRepository(crypto, () => em as never)

    const first = await repo.upsertByProfileId('profile-xyz', {
      displayName: 'Old Name',
      protocol: 'openai',
      baseUrl: 'https://old.com',
      apiKey: 'key-old',
    })

    const second = await repo.upsertByProfileId('profile-xyz', {
      displayName: 'New Name',
      protocol: 'anthropic',
      baseUrl: 'https://new.com',
      apiKey: 'key-new',
    })

    expect(second.id).toBe(first.id)
    expect(second.displayName).toBe('New Name')
    expect(second.protocol).toBe('anthropic')
    expect(second.baseUrl).toBe('https://new.com')
    expect(second.profileId).toBe('profile-xyz')
  })

  it('upsertByProfileId 更新后 resolveApiKey 得新 apiKey', async () => {
    const { em } = makeStubEmWithProfileId()
    const repo = new RelayUpstreamRepository(crypto, () => em as never)

    await repo.upsertByProfileId('profile-key-test', {
      displayName: 'K',
      protocol: 'openai',
      baseUrl: 'https://k.com',
      apiKey: 'key-v1',
    })

    const rec2 = await repo.upsertByProfileId('profile-key-test', {
      displayName: 'K',
      protocol: 'openai',
      baseUrl: 'https://k.com',
      apiKey: 'key-v2',
    })

    const plain = await repo.resolveApiKey(rec2.id)
    expect(plain).toBe('key-v2')
  })

  it('getByProfileId 存在返回记录，不存在返回 null', async () => {
    const { em } = makeStubEmWithProfileId()
    const repo = new RelayUpstreamRepository(crypto, () => em as never)

    await repo.upsertByProfileId('profile-get', {
      displayName: 'G',
      protocol: 'openai',
      baseUrl: 'https://g.com',
      apiKey: 'key-g',
    })

    const found = await repo.getByProfileId('profile-get')
    expect(found).not.toBeNull()
    expect(found!.displayName).toBe('G')
    expect(found!.profileId).toBe('profile-get')

    const missing = await repo.getByProfileId('no-such-profile')
    expect(missing).toBeNull()
  })

  it('deleteByProfileId 删除对应记录，其他记录不受影响', async () => {
    const { em, rows } = makeStubEmWithProfileId()
    const repo = new RelayUpstreamRepository(crypto, () => em as never)

    await repo.upsertByProfileId('profile-del', {
      displayName: 'Del',
      protocol: 'openai',
      baseUrl: 'https://del.com',
      apiKey: 'key-del',
    })
    await repo.upsertByProfileId('profile-keep', {
      displayName: 'Keep',
      protocol: 'openai',
      baseUrl: 'https://keep.com',
      apiKey: 'key-keep',
    })
    expect(rows).toHaveLength(2)

    await repo.deleteByProfileId('profile-del')
    expect(rows).toHaveLength(1)
    expect(rows[0].profileId).toBe('profile-keep')
  })

  it('deleteByProfileId 不存在时静默跳过（不抛错）', async () => {
    const { em } = makeStubEmWithProfileId()
    const repo = new RelayUpstreamRepository(crypto, () => em as never)

    await expect(repo.deleteByProfileId('non-existent-profile')).resolves.toBeUndefined()
  })

  it('upsertByProfileId models 列表往返正确', async () => {
    const { em } = makeStubEmWithProfileId()
    const repo = new RelayUpstreamRepository(crypto, () => em as never)

    const models = [{ id: 'gpt-4o', displayName: 'gpt-4o' }, { id: 'gpt-4', displayName: 'gpt-4' }]

    const rec = await repo.upsertByProfileId('profile-models', {
      displayName: 'M',
      protocol: 'openai',
      baseUrl: 'https://m.com',
      apiKey: 'key',
      models,
    })

    expect(rec.models).toEqual(models)
    expect(rec.profileId).toBe('profile-models')
  })
})
