import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

// pending_oauth table — 对应 sea-orm pending_oauth_entity Model.
//   id TEXT PK, provider TEXT, state TEXT, code_verifier TEXT,
//   redirect_path TEXT, bound_port INTEGER (nullable), created_at TEXT RFC3339,
//   expires_at TEXT RFC3339.

@Entity({ tableName: 'pending_oauth' })
export class PendingOAuthEntity {
  @PrimaryKey({ type: 'string', fieldName: 'id' })
  id!: string

  @Property({ type: 'string', fieldName: 'provider' })
  provider!: string

  @Property({ type: 'string', fieldName: 'state' })
  state!: string

  @Property({ type: 'string', fieldName: 'code_verifier' })
  codeVerifier!: string

  @Property({ type: 'string', fieldName: 'redirect_path' })
  redirectPath!: string

  @Property({ type: 'number', fieldName: 'bound_port', nullable: true })
  boundPort?: number | null

  @Property({ type: 'string', fieldName: 'created_at' })
  createdAt!: string

  @Property({ type: 'string', fieldName: 'expires_at' })
  expiresAt!: string
}
