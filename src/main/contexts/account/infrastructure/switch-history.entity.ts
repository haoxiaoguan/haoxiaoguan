import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/core'

// switch_history table — append-only audit log. 对应 sea-orm Model.
// id INTEGER PK AUTOINCREMENT; account_id/agent_id/trigger_type TEXT; success
// BOOL; error_message TEXT?; switched_at RFC3339 STRING. Index on switched_at.

@Entity({ tableName: 'switch_history' })
@Index({ name: 'idx_switch_history_switched_at', properties: ['switchedAt'] })
export class SwitchHistoryEntity {
  @PrimaryKey({ type: 'number', fieldName: 'id', autoincrement: true })
  id!: number

  @Property({ type: 'string', fieldName: 'account_id' })
  accountId!: string

  @Property({ type: 'string', fieldName: 'agent_id' })
  agentId!: string

  @Property({ type: 'string', fieldName: 'trigger_type' })
  triggerType!: string

  @Property({ type: 'boolean', fieldName: 'success' })
  success!: boolean

  @Property({ type: 'string', fieldName: 'error_message', nullable: true })
  errorMessage?: string | null

  @Property({ type: 'string', fieldName: 'switched_at' })
  switchedAt!: string
}
