// 客户端 API Key 鉴权（纯函数，M2b 简单版；加密多 Key 实体留 M5）。
// 取 Key 来源优先级：Authorization: Bearer <k> → x-api-key → x-goog-api-key → ?key=。
// 放行规则见 authorizeClientKey 注释。Hono 中间件（hono-app.ts）调用本模块。

export interface ClientKeyAuthConfig {
  keys: readonly string[]
  allowAnonymousLoopback: boolean
}

export interface ClientKeyRequestInfo {
  authorization?: string
  xApiKey?: string
  xGoogApiKey?: string
  queryKey?: string
  /** 远端地址是否回环（127.0.0.1/::1）。中间件从连接信息推断；测试直接给。 */
  isLoopback: boolean
}

export type AuthDecision = { ok: true; keyId?: string } | { ok: false; reason: 'missing' | 'invalid' }

/** 按优先级取客户端 Key；都没有则 undefined。 */
export function extractClientKey(info: ClientKeyRequestInfo): string | undefined {
  const auth = info.authorization?.trim()
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth)
    if (m) return m[1].trim()
  }
  if (info.xApiKey && info.xApiKey.trim()) return info.xApiKey.trim()
  if (info.xGoogApiKey && info.xGoogApiKey.trim()) return info.xGoogApiKey.trim()
  if (info.queryKey && info.queryKey.trim()) return info.queryKey.trim()
  return undefined
}

// 等长常量时间比较（明文 Key，防逐字时序猜测的轻量版；不引 node:crypto 以保持纯函数 + 可在任意环境跑）。
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * 鉴权决策（M2b 语义）：
 * - keys 为空 → 「未配置鉴权」，始终放行（allowAnonymousLoopback 仅影响“未配置时是否仍需本地”，
 *   M2b 不强制非回环，安全护栏留 M5）。即 keys.length===0 → { ok:true }。
 * - keys 非空 → 取到的 key ∈ keys 放行；取不到 → missing；取到但不匹配 → invalid。
 */
export function authorizeClientKey(
  info: ClientKeyRequestInfo,
  config: ClientKeyAuthConfig,
): AuthDecision {
  if (config.keys.length === 0) {
    // 未配置鉴权：放行。allowAnonymousLoopback=true 时本地直连本就免 Key；
    // 即使该标志为 false，M2b 也不在“无配置 Key”时拦截（避免锁死本地调试），强制护栏留 M5。
    return { ok: true }
  }
  const provided = extractClientKey(info)
  if (provided === undefined) return { ok: false, reason: 'missing' }
  for (const k of config.keys) {
    if (constantTimeEqual(k, provided)) return { ok: true, keyId: provided }
  }
  return { ok: false, reason: 'invalid' }
}
