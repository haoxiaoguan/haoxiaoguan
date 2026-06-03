import { describe, it, expect } from 'vitest'
import { ApiProxyKeyRepository } from '../../../src/main/contexts/apiProxy/infrastructure/api-proxy-key.repository'
import { CryptoService } from '../../../src/main/platform/crypto/crypto-service'
import { ApiProxyKeyEntity } from '../../../src/main/contexts/apiProxy/infrastructure/api-proxy-key.entity'

// 内存 stub EntityManager：仅实现 repo 用到的 findOne/find/persist/flush/nativeDelete
function makeStubEm() {
  const rows: ApiProxyKeyEntity[] = []
  return {
    rows,
    em: {
      async findOne(_e: unknown, where: { id: string }) { return rows.find((r) => r.id === where.id) ?? null },
      async find(_e: unknown) { return [...rows] },
      persist(entity: ApiProxyKeyEntity) { rows.push(entity) },
      async flush() { /* no-op */ },
      async nativeDelete(_e: unknown, where: { id: string }) {
        const i = rows.findIndex((r) => r.id === where.id); if (i >= 0) rows.splice(i, 1); return 1
      },
    },
  }
}

const crypto = new CryptoService(Buffer.alloc(32, 7)) // 测试 master key

describe('ApiProxyKeyRepository', () => {
  it('create 加密落库 + 返回 meta（不含明文/密文）', async () => {
    const { em, rows } = makeStubEm()
    const repo = new ApiProxyKeyRepository(crypto, () => em as never)
    const meta = await repo.create('my-key', 'sk-hxg-ABCDEFGHabcdefgh0123456789012345')
    expect(meta.name).toBe('my-key')
    expect(meta.keyPrefix).toBe('sk-hxg-A') // 前 8 字符
    expect(meta.isActive).toBe(true)
    expect(rows).toHaveLength(1)
    expect(rows[0].keyEnc).not.toContain('ABCDEFGH') // 密文不含明文
    expect((meta as Record<string, unknown>).plaintext).toBeUndefined()
  })
  it('listActivePlaintext 解密只取 active', async () => {
    const { em } = makeStubEm()
    const repo = new ApiProxyKeyRepository(crypto, () => em as never)
    const a = await repo.create('a', 'sk-hxg-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    await repo.create('b', 'sk-hxg-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
    await repo.setActive(a.id, false)
    const keys = await repo.listActivePlaintext()
    expect(keys).toEqual(['sk-hxg-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'])
  })
  it('listMeta 不解密、含全部', async () => {
    const { em } = makeStubEm()
    const repo = new ApiProxyKeyRepository(crypto, () => em as never)
    await repo.create('a', 'sk-hxg-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    const metas = await repo.listMeta()
    expect(metas).toHaveLength(1)
    expect(metas[0]).not.toHaveProperty('keyEnc')
  })
  it('delete 移除', async () => {
    const { em, rows } = makeStubEm()
    const repo = new ApiProxyKeyRepository(crypto, () => em as never)
    const m = await repo.create('a', 'sk-hxg-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    await repo.delete(m.id)
    expect(rows).toHaveLength(0)
  })
})
