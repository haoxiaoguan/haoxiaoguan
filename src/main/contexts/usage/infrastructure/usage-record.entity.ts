/**
 * MikroORM entity for usage_records table.
 * Mirrors Rust usage_record_entity.rs — column names and types are authoritative.
 * occurred_at and raw_updated_at are Unix seconds stored as BIGINT (INTEGER in SQLite).
 */
import { Entity, PrimaryKey, Property, Index, Unique } from '@mikro-orm/core'

@Entity({ tableName: 'usage_records' })
@Unique({ properties: ['agentId', 'sourceKind', 'sourcePath', 'sourceEventId'] })
@Index({ properties: ['agentId', 'occurredAt'] })
@Index({ properties: ['occurredAt'] })
export class UsageRecordEntity {
  @PrimaryKey({ type: 'integer', autoincrement: true })
  id!: number

  @Property({ type: 'text', fieldName: 'agent_id' })
  agentId!: string

  @Property({ type: 'text', fieldName: 'source_kind', nullable: true })
  sourceKind!: string

  @Property({ type: 'text', fieldName: 'source_path', nullable: true })
  sourcePath!: string

  @Property({ type: 'text', fieldName: 'source_event_id', nullable: true })
  sourceEventId!: string

  @Property({ type: 'text', fieldName: 'session_id', nullable: true })
  sessionId?: string

  @Property({ type: 'text', nullable: true })
  model!: string

  @Property({ type: 'text', fieldName: 'provider_name', nullable: true })
  providerName?: string

  @Property({ type: 'integer', fieldName: 'input_tokens' })
  inputTokens!: number

  @Property({ type: 'integer', fieldName: 'output_tokens' })
  outputTokens!: number

  @Property({ type: 'integer', fieldName: 'cache_read_tokens' })
  cacheReadTokens!: number

  @Property({ type: 'integer', fieldName: 'cache_creation_tokens' })
  cacheCreationTokens!: number

  /** Unix seconds (BIGINT in source schema). */
  @Property({ type: 'bigint', fieldName: 'occurred_at' })
  occurredAt!: number

  @Property({ type: 'bigint', fieldName: 'raw_updated_at' })
  rawUpdatedAt!: number

  @Property({ type: 'text', fieldName: 'raw_hash', nullable: true })
  rawHash!: string

  @Property({ type: 'bigint', fieldName: 'created_at' })
  createdAt!: number
}
