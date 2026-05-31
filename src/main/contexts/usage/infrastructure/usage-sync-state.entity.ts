/**
 * MikroORM entity for usage_sync_state table.
 * Composite PK: (reader_name, source_path).
 * Two sentinel source_path values are used as status markers:
 *   "__usage_sync_result_status__"      → last_cursor holds "success" | "failed"
 *   "__usage_sync_result_success_at__"  → updated_at holds timestamp of last success
 */
import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

@Entity({ tableName: 'usage_sync_state' })
export class UsageSyncStateEntity {
  @PrimaryKey({ type: 'text', fieldName: 'reader_name' })
  readerName!: string

  @PrimaryKey({ type: 'text', fieldName: 'source_path' })
  sourcePath!: string

  @Property({ type: 'bigint', fieldName: 'last_offset' })
  lastOffset!: number

  @Property({ type: 'bigint', fieldName: 'last_modified_ns' })
  lastModifiedNs!: number

  @Property({ type: 'text', fieldName: 'last_cursor', nullable: true })
  lastCursor?: string

  @Property({ type: 'bigint', fieldName: 'updated_at' })
  updatedAt!: number
}
