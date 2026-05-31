import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

// pending_import table — 对应 sea-orm pending_import Model.
//   id TEXT PK, provider TEXT, payload_json TEXT, created_at TEXT RFC3339,
//   expires_at TEXT RFC3339.

@Entity({ tableName: 'pending_import' })
export class PendingImportEntity {
  @PrimaryKey({ type: 'string', fieldName: 'id' })
  id!: string

  @Property({ type: 'string', fieldName: 'provider' })
  provider!: string

  @Property({ type: 'string', fieldName: 'payload_json' })
  payloadJson!: string

  @Property({ type: 'string', fieldName: 'created_at' })
  createdAt!: string

  @Property({ type: 'string', fieldName: 'expires_at' })
  expiresAt!: string
}
