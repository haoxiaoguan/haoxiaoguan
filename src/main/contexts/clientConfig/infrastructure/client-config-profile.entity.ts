import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

// 客户端接入档（provider profile）持久化实体。一个客户端可存多份，is_current 标记当前生效。
// 第三方明文 key 经 envelope 加密存 key_enc；指向本机反代的档用 key_ref（反代 key 表 id）。
@Entity({ tableName: 'client_config_profiles' })
export class ClientConfigProfileEntity {
  @PrimaryKey({ type: 'string', fieldName: 'id' }) id!: string
  @Property({ type: 'string', fieldName: 'client_id' }) clientId!: string
  @Property({ type: 'string', fieldName: 'name' }) name!: string
  /** 'local-proxy' | 'manual' */
  @Property({ type: 'string', fieldName: 'source' }) source!: string
  @Property({ type: 'string', fieldName: 'base_url' }) baseUrl!: string
  @Property({ type: 'string', fieldName: 'model', nullable: true }) model?: string
  /** 第三方明文 key 的加密信封（JSON StoredEnvelope）。 */
  @Property({ type: 'string', fieldName: 'key_enc', nullable: true }) keyEnc?: string
  /** 指向反代 client key 表的 id（local-proxy 用，phase3 解析）。 */
  @Property({ type: 'string', fieldName: 'key_ref', nullable: true }) keyRef?: string
  @Property({ type: 'boolean', fieldName: 'is_current' }) isCurrent!: boolean
  /** 累加式:是否已注入 live（多份可同时为 true）。 */
  @Property({ type: 'boolean', fieldName: 'enabled', default: false }) enabled!: boolean
  /** 累加式:是否默认指针（每客户端至多一份）。 */
  @Property({ type: 'boolean', fieldName: 'is_default', default: false }) isDefault!: boolean
  @Property({ type: 'number', fieldName: 'sort_index' }) sortIndex!: number
  /** per-client 额外配置（JSON，按客户端形态各异；MVP 可空）。 */
  @Property({ type: 'string', fieldName: 'settings_config', nullable: true }) settingsConfig?: string
  @Property({ type: 'string', fieldName: 'created_at' }) createdAt!: string
  @Property({ type: 'string', fieldName: 'updated_at' }) updatedAt!: string
  @Property({ type: 'string', fieldName: 'notes', nullable: true }) notes?: string
}
