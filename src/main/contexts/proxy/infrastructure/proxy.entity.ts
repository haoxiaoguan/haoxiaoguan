import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/core'

// proxies table — owned by the proxy context.
//
// All columns TEXT except port (integer). Timestamps are RFC3339 STRINGS
// (created_at / last_checked_at), matching the account/credential convention.
// password_enc holds the JSON-stringified StoredEnvelope ({ aad, envelope })
// — NEVER the plaintext password. tags_json is a JSON string array.

@Entity({ tableName: 'proxies' })
@Index({ name: 'idx_proxies_dedupe', properties: ['dedupeKey'] })
export class ProxyEntity {
  @PrimaryKey({ type: 'string', fieldName: 'id' })
  id!: string

  @Property({ type: 'string', fieldName: 'label', nullable: true })
  label?: string | null

  @Property({ type: 'string', fieldName: 'protocol' })
  protocol!: string

  @Property({ type: 'string', fieldName: 'host' })
  host!: string

  @Property({ type: 'integer', fieldName: 'port' })
  port!: number

  @Property({ type: 'string', fieldName: 'username', nullable: true })
  username?: string | null

  /** JSON-stringified StoredEnvelope of the password, or null when no password. */
  @Property({ type: 'string', fieldName: 'password_enc', nullable: true })
  passwordEnc?: string | null

  @Property({ type: 'string', fieldName: 'status' })
  status!: string

  @Property({ type: 'string', fieldName: 'last_egress_ip', nullable: true })
  lastEgressIp?: string | null

  @Property({ type: 'integer', fieldName: 'last_latency_ms', nullable: true })
  lastLatencyMs?: number | null

  @Property({ type: 'string', fieldName: 'last_checked_at', nullable: true })
  lastCheckedAt?: string | null

  @Property({ type: 'string', fieldName: 'last_error', nullable: true })
  lastError?: string | null

  /** JSON array of strings. */
  @Property({ type: 'string', fieldName: 'tags_json' })
  tagsJson!: string

  /** Denormalised protocol+host+port+username dedupe key (indexed). */
  @Property({ type: 'string', fieldName: 'dedupe_key' })
  dedupeKey!: string

  @Property({ type: 'string', fieldName: 'created_at' })
  createdAt!: string
}
