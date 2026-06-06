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
  /** 切换式:标记某接入档当前生效（同 client 其余置否）。 */
  setCurrent(clientId: ClientId, id: string): Promise<void>
  /** 累加式:启/停某档注入（不影响其它档）。 */
  setEnabled(id: string, enabled: boolean): Promise<void>
  /** 累加式:设默认指针（同 client 其余置否）。 */
  setDefault(clientId: ClientId, id: string): Promise<void>
  /** 解出该接入档的明文 api key（local-proxy 与第三方均解密 key_enc）。 */
  resolveApiKey(id: string): Promise<string>
  /** 取该档的 keyRef（local-proxy 档指向的反代 client key id；无则 null）。供删档时联动吊销。 */
  getKeyRef(id: string): Promise<string | null>
}
