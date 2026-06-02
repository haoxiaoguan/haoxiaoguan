import { Entity, ManyToOne, PrimaryKeyProp, Property } from '@mikro-orm/core'
import { AccountEntity } from './account.entity'

// account_tags table — composite PK (account_id, tag). FK → accounts ON DELETE
// CASCADE (cascade relies on PRAGMA foreign_keys = ON, set in database.ts).
// Tags are replaced wholesale on each save (delete-then-insert in a transaction).

@Entity({ tableName: 'account_tags' })
export class AccountTagEntity {
  // ManyToOne with the FK column named account_id; deleteRule cascade maps to
  // ON DELETE CASCADE.
  @ManyToOne(() => AccountEntity, {
    fieldName: 'account_id',
    deleteRule: 'cascade',
    primary: true,
  })
  account!: AccountEntity

  @Property({ type: 'string', fieldName: 'tag', primary: true })
  tag!: string;

  [PrimaryKeyProp]?: ['account', 'tag']
}
