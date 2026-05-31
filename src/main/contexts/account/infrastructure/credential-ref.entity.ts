import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/core'

// credentials table — OWNED BY THE CREDENTIAL CONTEXT.
//
// This entity is defined here only so the account context can compile, run its
// repository round-trip tests, and store/retrieve encrypted credentials in
// isolation before the credential context lands. At integration the credential
// context provides the authoritative entity + repository and this file should be
// removed (see the account manifest). The column shape follows
// map_frontend_ipc: account_id TEXT PK, envelope_json TEXT, key_id TEXT,
// version INT, updated_at TEXT (RFC3339). FK → accounts ON DELETE CASCADE.
//
// NOTE: MikroORM auto-discovers *.entity.ts by glob. To avoid a duplicate-table
// clash once the credential context registers its own `credentials` entity, this
// file is named `credential-ref.entity.ts` and the manifest instructs removing
// it during credential-context integration.

@Entity({ tableName: 'credentials' })
@Index({ name: 'idx_credentials_account', properties: ['accountId'] })
export class CredentialRefEntity {
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
