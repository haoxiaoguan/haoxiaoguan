// MikroORM entity for the mcp_servers table.
// Mirrors Rust sea-orm entity exactly: TEXT PK, INTEGER timestamps (Unix seconds).
// server_json / apps_json / tags_json are stored as TEXT (JSON strings) — the
// domain layer owns serialisation (McpServer.specToJson / appsToJson / tagsToJson).
// created_at is intentionally excluded from the upsert UPDATE SET list (see
// MikroOrmMcpServerRepository) so it is never overwritten after first insert.

import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

@Entity({ tableName: 'mcp_servers' })
export class McpServerEntity {
  @PrimaryKey({ type: 'text' })
  id!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  /** JSON-serialised McpServerSpec */
  @Property({ type: 'text' })
  server_json!: string

  /** JSON object { "<agent_id>": boolean } */
  @Property({ type: 'text' })
  apps_json!: string

  @Property({ type: 'text', nullable: true })
  homepage?: string | null

  @Property({ type: 'text', nullable: true })
  docs?: string | null

  /** JSON array of strings */
  @Property({ type: 'text' })
  tags_json!: string

  /** Unix timestamp seconds — set once on insert, never updated */
  @Property({ type: 'bigint' })
  created_at!: number

  /** Unix timestamp seconds — refreshed on every save */
  @Property({ type: 'bigint' })
  updated_at!: number

  @Property({ type: 'integer' })
  sort_order!: number
}
