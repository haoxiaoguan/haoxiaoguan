import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

@Entity({ tableName: 'api_proxy_keys' })
export class ApiProxyKeyEntity {
  @PrimaryKey({ type: 'string', fieldName: 'id' }) id!: string
  @Property({ type: 'string', fieldName: 'name' }) name!: string
  @Property({ type: 'string', fieldName: 'key_prefix' }) keyPrefix!: string
  @Property({ type: 'string', fieldName: 'key_enc' }) keyEnc!: string
  @Property({ type: 'string', fieldName: 'key_id' }) keyId!: string
  @Property({ type: 'number', fieldName: 'version' }) version!: number
  @Property({ type: 'boolean', fieldName: 'is_active' }) isActive!: boolean
  @Property({ type: 'string', fieldName: 'created_at' }) createdAt!: string
  @Property({ type: 'string', fieldName: 'updated_at' }) updatedAt!: string
}
