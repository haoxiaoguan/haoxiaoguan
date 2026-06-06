// 接入档存储端口（DDD：application 定义契约，infrastructure 用 MikroORM 实现，测试可用内存假实现）。
import type { ClientId, ClientConfigProfile, ProfileSource } from '../domain/client-profile'

export interface CreateProfileInput {
  clientId: ClientId
  name: string
  source: ProfileSource
  baseUrl: string
  model?: string
  /** 第三方明文 key（加密落库）。local-proxy 走 keyRef。 */
  apiKey?: string
  keyRef?: string
  notes?: string
}

export interface UpdateProfileInput {
  name?: string
  baseUrl?: string
  /** null = 清空 model。 */
  model?: string | null
  apiKey?: string
  notes?: string | null
}

export interface ClientConfigStore {
  list(clientId?: ClientId): Promise<ClientConfigProfile[]>
  get(id: string): Promise<ClientConfigProfile | null>
  create(input: CreateProfileInput): Promise<ClientConfigProfile>
  update(id: string, patch: UpdateProfileInput): Promise<void>
  delete(id: string): Promise<void>
  /** 标记某接入档当前生效（同 client 其余置否）。 */
  setCurrent(clientId: ClientId, id: string): Promise<void>
  /** 解出该接入档的明文 api key（解密 key_enc；local-proxy 的 key_ref 解析见 phase3）。 */
  resolveApiKey(id: string): Promise<string>
}
