// MikroORM-backed implementation of McpServerRepository.
// Uses raw SQL via the underlying connection (same pattern as skill/usage repos)
// so that entity decorator files are not imported at test time.
//
// Upsert semantics: INSERT … ON CONFLICT(id) DO UPDATE SET … intentionally
// excludes created_at so it is never overwritten after first insert (mirrors
// Rust sea-orm upsert that excludes created_at from the update columns list).

import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm as defaultGetEm } from '../../../platform/persistence/database'
import type { McpServerRepository } from '../domain/mcp-server-repository'
import { McpServer } from '../domain/mcp-server'

interface McpServerRow {
  id: string
  name: string
  description: string | null
  server_json: string
  apps_json: string
  homepage: string | null
  docs: string | null
  tags_json: string
  created_at: number
  updated_at: number
  sort_order: number
}

function rowToDomain(row: McpServerRow): McpServer {
  return McpServer.fromRow({
    id: row.id,
    name: row.name,
    description: row.description,
    server_json: row.server_json,
    apps_json: row.apps_json,
    homepage: row.homepage,
    docs: row.docs,
    tags_json: row.tags_json,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    sort_order: Number(row.sort_order),
  })
}

export class MikroOrmMcpServerRepository implements McpServerRepository {
  private readonly getEm: () => EntityManager

  constructor(getEmFn?: () => EntityManager) {
    this.getEm = getEmFn ?? defaultGetEm
  }

  async findAll(): Promise<McpServer[]> {
    const conn = this.getEm().getConnection()
    const rows = (await conn.execute(
      'SELECT * FROM mcp_servers ORDER BY sort_order ASC',
    )) as McpServerRow[]
    return rows.map(rowToDomain)
  }

  async findById(id: string): Promise<McpServer | null> {
    const conn = this.getEm().getConnection()
    const rows = (await conn.execute('SELECT * FROM mcp_servers WHERE id = ?', [
      id,
    ])) as McpServerRow[]
    return rows[0] ? rowToDomain(rows[0]) : null
  }

  async save(server: McpServer): Promise<void> {
    const conn = this.getEm().getConnection()
    await conn.execute(
      `INSERT INTO mcp_servers
        (id, name, description, server_json, apps_json, homepage, docs, tags_json,
         created_at, updated_at, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name        = excluded.name,
         description = excluded.description,
         server_json = excluded.server_json,
         apps_json   = excluded.apps_json,
         homepage    = excluded.homepage,
         docs        = excluded.docs,
         tags_json   = excluded.tags_json,
         updated_at  = excluded.updated_at,
         sort_order  = excluded.sort_order`,
      // created_at is intentionally absent from the UPDATE SET list above
      [
        server.id,
        server.name,
        server.description ?? null,
        server.specToJson(),
        server.appsToJson(),
        server.homepage ?? null,
        server.docs ?? null,
        server.tagsToJson(),
        server.created_at,
        server.updated_at,
        server.sort_order,
      ],
    )
  }

  async delete(id: string): Promise<void> {
    const conn = this.getEm().getConnection()
    await conn.execute('DELETE FROM mcp_servers WHERE id = ?', [id])
  }
}
