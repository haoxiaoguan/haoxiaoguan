import { Entity, PrimaryKey, Property, Unique, Index } from '@mikro-orm/core'

// accounts table — 对应 sea-orm Model exactly.
//
// Columns are all TEXT except is_active (boolean). Timestamps are RFC3339
// STRINGS (created_at / last_used_at), NOT integers — per the source and the
// migration convention (accounts/credentials use ISO strings). profile_payload
// is stored as a JSON string in a TEXT column (profile_payload_json), matching
// the source; we keep it as a string here and (de)serialize in the repository
// to preserve byte-for-byte column shape.
//
// Indexes: UNIQUE (agent_id, identity_key); INDEX (agent_id, is_active) — per
// map_frontend_ipc infrastructure notes.

@Entity({ tableName: 'accounts' })
@Unique({ name: 'idx_accounts_agent_identity', properties: ['agentId', 'identityKey'] })
@Index({ name: 'idx_accounts_agent_active', properties: ['agentId', 'isActive'] })
export class AccountEntity {
  @PrimaryKey({ type: 'string', fieldName: 'id' })
  id!: string

  @Property({ type: 'string', fieldName: 'agent_id' })
  agentId!: string

  @Property({ type: 'string', fieldName: 'email' })
  email!: string

  @Property({ type: 'string', fieldName: 'identity_key' })
  identityKey!: string

  @Property({ type: 'string', fieldName: 'display_identifier' })
  displayIdentifier!: string

  @Property({ type: 'string', fieldName: 'name', nullable: true })
  name?: string | null

  @Property({ type: 'string', fieldName: 'login_provider', nullable: true })
  loginProvider?: string | null

  @Property({ type: 'string', fieldName: 'plan_name', nullable: true })
  planName?: string | null

  @Property({ type: 'string', fieldName: 'plan_tier', nullable: true })
  planTier?: string | null

  @Property({ type: 'string', fieldName: 'status', nullable: true })
  status?: string | null

  @Property({ type: 'string', fieldName: 'status_reason', nullable: true })
  statusReason?: string | null

  @Property({ type: 'string', fieldName: 'profile_payload_json' })
  profilePayloadJson!: string

  @Property({ type: 'string', fieldName: 'notes', nullable: true })
  notes?: string | null

  @Property({ type: 'boolean', fieldName: 'is_active' })
  isActive!: boolean

  @Property({ type: 'string', fieldName: 'created_at' })
  createdAt!: string

  @Property({ type: 'string', fieldName: 'last_used_at', nullable: true })
  lastUsedAt?: string | null
}
