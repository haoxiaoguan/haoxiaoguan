import { Entity, ManyToOne, PrimaryKeyProp, Property } from '@mikro-orm/core'
import { AccountEntity } from '../../account/infrastructure/account.entity'

// quota_cache table — composite PK (account_id, model). 对应 sea-orm
// Model: used/total are INTEGER, reset_at TEXT? (RFC3339), fetched_at TEXT
// (RFC3339). FK account_id → accounts ON DELETE CASCADE (cascade relies on
// PRAGMA foreign_keys = ON, set in database.ts). Save does delete-all-for-account
// then re-insert each model (wrapped in a transaction by the repository).

@Entity({ tableName: 'quota_cache' })
export class QuotaCacheEntity {
  @ManyToOne(() => AccountEntity, {
    fieldName: 'account_id',
    deleteRule: 'cascade',
    primary: true,
  })
  account!: AccountEntity

  @Property({ type: 'string', fieldName: 'model', primary: true })
  model!: string

  @Property({ type: 'number', fieldName: 'used' })
  used!: number

  @Property({ type: 'number', fieldName: 'total' })
  total!: number

  @Property({ type: 'string', fieldName: 'reset_at', nullable: true })
  resetAt?: string | null

  @Property({ type: 'string', fieldName: 'fetched_at' })
  fetchedAt!: string;

  [PrimaryKeyProp]?: ['account', 'model']
}
