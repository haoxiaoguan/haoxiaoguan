// 本机反代接入的窄端口（DDD：clientConfig 不直接 import apiProxy 的请求处理，
// container 用 ApiProxyService/ApiProxyKeyService/PlatformRegistry 实现此端口注入，避免循环依赖）。
export interface LocalProxyPort {
  /** 反代当前监听端口；未运行返回 null。 */
  getPort(): number | null
  /** 签发一把客户端 key（加密落库），返回 id + 一次性明文。 */
  signKey(name: string): Promise<{ id: string; plaintext: string }>
  /** 吊销客户端 key（删 profile 联动用；phase6）。 */
  revokeKey(id: string): Promise<void>
  /** 反代暴露的模型 id 列表（预填默认模型用）。 */
  listModels(): string[]
}

/** 测连通结果。 */
export interface ConnTestResult {
  ok: boolean
  status?: number
  message?: string
}
