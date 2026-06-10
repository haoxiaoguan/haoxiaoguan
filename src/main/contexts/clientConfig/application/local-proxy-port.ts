// 本机反代接入的窄端口（DDD：clientConfig 不直接 import apiProxy 的请求处理，
// container 用 ApiProxyService/ApiProxyKeyService/PlatformRegistry 实现此端口注入，避免循环依赖）。
export interface LocalProxyPort {
  /** 反代当前监听端口；未运行返回 null。 */
  getPort(): number | null
  /**
   * 确保反代已运行并返回其监听端口（路由联动用）：已运行直接返回当前端口；
   * 未运行则先启动反代再取端口。取不到端口（启动后仍未就绪）抛清晰错误。
   */
  ensureStarted(): Promise<number>
  /** 签发一把客户端 key（加密落库），返回 id + 一次性明文。 */
  signKey(name: string): Promise<{ id: string; plaintext: string }>
  /** 吊销客户端 key（删 profile 联动用；phase6）。 */
  revokeKey(id: string): Promise<void>
  /** 反代暴露的模型 id 列表（预填默认模型用）。 */
  listModels(): string[]
  /**
   * 反代暴露的**非原生**模型（Codex L2 catalog 用）：排除 Codex 原生模型（由 Codex 自带
   * models_cache 提供）与占位 echo，只留账号池 Claude + 第三方 relay 模型。
   */
  listCatalogModels(): CatalogModel[]
  /**
   * 仅「号小管账号池」(Kiro/Claude) 的模型 —— 用于 L2 下「号小管账号」这个供应商被启用时，
   * 把账号池模型并入 catalog（与第三方 relay 模型区分开，按启用态精确聚合）。
   */
  listAccountPoolModels(): CatalogModel[]
  /**
   * 原生（ChatGPT 登录账号）的模型 slug 列表。
   * 供 responses 透传供应商「ON 撞名别名」逻辑检测是否需要加 -hxg 后缀。
   * 未配置（无 auth.json）时返回空数组。
   */
  listNativeModelSlugs?(): string[]
}

/** L2 catalog 条目所需的最小模型信息。 */
export interface CatalogModel {
  id: string
  displayName?: string
  contextLength?: number
}

/** 测连通结果。 */
export interface ConnTestResult {
  ok: boolean
  status?: number
  message?: string
}
