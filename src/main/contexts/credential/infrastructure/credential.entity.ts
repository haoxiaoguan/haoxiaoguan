import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/core'

// credentials table — OWNED BY THE CREDENTIAL CONTEXT (authoritative entity).
//
// Columns:
//   account_id TEXT PK, envelope_json TEXT, key_id TEXT, version INT, updated_at
//   TEXT (RFC3339). FK → accounts ON DELETE CASCADE (cascade relies on
//   PRAGMA foreign_keys = ON, set in platform/persistence/database.ts).
//
// IMPORTANT (integration): the account context currently ships a TEMP
// `CredentialRefEntity` (account/infrastructure/credential-ref.entity.ts) that
// maps the SAME `credentials` table. MikroORM auto-discovers *.entity.ts by glob,
// so registering BOTH would clash on table name. At integration, DELETE the
// account context's `credential-ref.entity.ts` (and its
// `mikro-orm-credential-store.ts`) and wire the account service to this
// context's `MikroOrmCredentialRepository` (which implements the account
// `CredentialStorePort`). See the credential manifest §integration.

@Entity({ tableName: 'credentials' })
@Index({ name: 'idx_credentials_account', properties: ['accountId'] })
export class CredentialEntity {
  @PrimaryKey({ type: 'string', fieldName: 'account_id' })
  accountId!: string

  @Property({ type: 'string', fieldName: 'envelope_json' })
  envelopeJson!: string

  @Property({ type: 'string', fieldName: 'key_id' })
  keyId!: string

  @Property({ type: 'number', fieldName: 'version' })
  version!: number

  @Property({ type: 'string', fieldName: 'updated_at' })
  updatedAt!: string
}
