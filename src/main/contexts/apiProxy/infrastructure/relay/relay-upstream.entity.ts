import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

@Entity({ tableName: 'relay_upstreams' })
export class RelayUpstreamEntity {
  @PrimaryKey({ type: 'string', fieldName: 'id' }) id!: string
  @Property({ type: 'string', fieldName: 'display_name' }) displayName!: string
  /** 'openai' | 'anthropic' | 'gemini' */
  @Property({ type: 'string', fieldName: 'protocol' }) protocol!: string
  @Property({ type: 'string', fieldName: 'base_url' }) baseUrl!: string
  /** StoredEnvelope JSON，AES-GCM 加密的 apiKey */
  @Property({ type: 'string', fieldName: 'key_enc' }) keyEnc!: string
  /** JSON 数组的 ModelInfo；可空 */
  @Property({ type: 'string', fieldName: 'models_json', nullable: true }) modelsJson!: string | null
  @Property({ type: 'boolean', fieldName: 'enabled' }) enabled!: boolean
  @Property({ type: 'string', fieldName: 'created_at' }) createdAt!: string
  @Property({ type: 'string', fieldName: 'updated_at' }) updatedAt!: string
}
