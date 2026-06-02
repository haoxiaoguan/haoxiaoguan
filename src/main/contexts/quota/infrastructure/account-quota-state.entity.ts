import { Entity, ManyToOne, PrimaryKeyProp, Property } from '@mikro-orm/core'
import { AccountEntity } from '../../account/infrastructure/account.entity'

// account_quota_state table — single row per account (PK account_id).
// summary columns (quota_status TEXT, primary_metric_key/
// primary_label/primary_value TEXT?, primary_percent REAL?, primary_unit TEXT,
// reset_at/fetched_at TEXT?) plus quota_payload_json TEXT (sanitised
// AccountQuotaState JSON). Upsert on conflict(account_id). FK → accounts ON
// DELETE CASCADE.

@Entity({ tableName: 'account_quota_state' })
export class AccountQuotaStateEntity {
  @ManyToOne(() => AccountEntity, {
    fieldName: 'account_id',
    deleteRule: 'cascade',
    primary: true,
  })
  account!: AccountEntity

  @Property({ type: 'string', fieldName: 'quota_status' })
  quotaStatus!: string

  @Property({ type: 'string', fieldName: 'primary_metric_key', nullable: true })
  primaryMetricKey?: string | null

  @Property({ type: 'string', fieldName: 'primary_label', nullable: true })
  primaryLabel?: string | null

  @Property({ type: 'string', fieldName: 'primary_value', nullable: true })
  primaryValue?: string | null

  @Property({ type: 'double', fieldName: 'primary_percent', nullable: true })
  primaryPercent?: number | null

  @Property({ type: 'string', fieldName: 'primary_unit' })
  primaryUnit!: string

  @Property({ type: 'string', fieldName: 'reset_at', nullable: true })
  resetAt?: string | null

  @Property({ type: 'string', fieldName: 'fetched_at', nullable: true })
  fetchedAt?: string | null

  @Property({ type: 'string', fieldName: 'quota_payload_json' })
  quotaPayloadJson!: string;

  [PrimaryKeyProp]?: ['account']
}
