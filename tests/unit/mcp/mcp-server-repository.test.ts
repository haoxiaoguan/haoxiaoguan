// Unit tests for MikroOrmMcpServerRepository.
// Uses an in-memory SQLite database via MikroORM + better-sqlite3.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MikroORM } from '@mikro-orm/better-sqlite'
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { McpServerEntity } from '../../../src/main/contexts/mcp/infrastructure/mcp-server.entity'
import { MikroOrmMcpServerRepository } from '../../../src/main/contexts/mcp/infrastructure/mikro-orm-mcp-server-repository'
import { McpServer } from '../../../src/main/contexts/mcp/domain/mcp-server'
import type { McpServerSpec } from '../../../src/main/contexts/mcp/domain/mcp-server'

const SPEC: McpServerSpec = {
  transport: 'stdio',
  command: 'npx',
  args: ['-y', 'some-mcp-server'],
  env: null,
  url: null,
}

let orm: MikroORM
let getEm: () => EntityManager

beforeEach(async () => {
  orm = await MikroORM.init({
    driver: (await import('@mikro-orm/better-sqlite')).SqliteDriver,
    dbName: ':memory:',
    entities: [McpServerEntity],
    allowGlobalContext: true,
  })
  await orm.getSchemaGenerator().createSchema()
  getEm = () => orm.em.fork()
})

afterEach(async () => {
  await orm.close(true)
})

function makeServer(overrides: Partial<{ id: string; name: string; sort_order: number }> = {}): McpServer {
  const now = 1700000000
  return McpServer.create({
    id: overrides.id ?? 'server-1',
    name: overrides.name ?? 'Test Server',
    description: 'A test server',
    spec: SPEC,
    apps: { claude: true, codex: false },
    homepage: 'https://example.com',
    docs: null,
    tags: ['tag1'],
    sort_order: overrides.sort_order ?? 0,
    now,
  })
}

describe('MikroOrmMcpServerRepository', () => {
  it('save and findAll returns the server', async () => {
    const repo = new MikroOrmMcpServerRepository(getEm)
    const server = makeServer()
    await repo.save(server)

    const all = await repo.findAll()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe('server-1')
    expect(all[0].name).toBe('Test Server')
    expect(all[0].spec).toEqual(SPEC)
    expect(all[0].apps.get('claude')).toBe(true)
    expect(all[0].apps.get('codex')).toBe(false)
    expect(all[0].tags).toEqual(['tag1'])
  })

  it('findById returns null for missing id', async () => {
    const repo = new MikroOrmMcpServerRepository(getEm)
    const result = await repo.findById('nonexistent')
    expect(result).toBeNull()
  })

  it('findById returns the server when present', async () => {
    const repo = new MikroOrmMcpServerRepository(getEm)
    const server = makeServer()
    await repo.save(server)

    const found = await repo.findById('server-1')
    expect(found).not.toBeNull()
    expect(found!.id).toBe('server-1')
  })

  it('upsert updates fields but preserves created_at', async () => {
    const repo = new MikroOrmMcpServerRepository(getEm)
    const server = makeServer()
    await repo.save(server)

    // Mutate and save again
    server.name = 'Updated Name'
    server.touch(1700000999)
    await repo.save(server)

    const found = await repo.findById('server-1')
    expect(found!.name).toBe('Updated Name')
    expect(found!.updated_at).toBe(1700000999)
    expect(found!.created_at).toBe(1700000000) // must not change
  })

  it('delete removes the server', async () => {
    const repo = new MikroOrmMcpServerRepository(getEm)
    const server = makeServer()
    await repo.save(server)

    await repo.delete('server-1')
    const all = await repo.findAll()
    expect(all).toHaveLength(0)
  })

  it('findAll orders by sort_order ASC', async () => {
    const repo = new MikroOrmMcpServerRepository(getEm)
    await repo.save(makeServer({ id: 'b', name: 'B', sort_order: 10 }))
    await repo.save(makeServer({ id: 'a', name: 'A', sort_order: 1 }))
    await repo.save(makeServer({ id: 'c', name: 'C', sort_order: 5 }))

    const all = await repo.findAll()
    expect(all.map((s) => s.id)).toEqual(['a', 'c', 'b'])
  })

  it('save multiple servers and findAll returns all', async () => {
    const repo = new MikroOrmMcpServerRepository(getEm)
    await repo.save(makeServer({ id: 's1', name: 'S1' }))
    await repo.save(makeServer({ id: 's2', name: 'S2' }))
    await repo.save(makeServer({ id: 's3', name: 'S3' }))

    const all = await repo.findAll()
    expect(all).toHaveLength(3)
  })
})
