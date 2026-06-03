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
 * 鉴权决策（M5 语义，激活 loopback 护栏）：
 * - keys 为空 → 未配置鉴权；allowAnonymousLoopback && isLoopback → 放行，否则拒（missing）。
 * - keys 非空 → 没带 key：allowAnonymousLoopback && isLoopback → 免 key 放行，否则 missing；
 *               带了 key：常量时间比对，匹配放行（keyId），否则 invalid。
 */
export function authorizeClientKey(
  info: ClientKeyRequestInfo,
  config: ClientKeyAuthConfig,
): AuthDecision {
  if (config.keys.length === 0) {
    if (config.allowAnonymousLoopback && info.isLoopback) return { ok: true }
    return { ok: false, reason: 'missing' }
  }
  const provided = extractClientKey(info)
  if (provided === undefined) {
    if (config.allowAnonymousLoopback && info.isLoopback) return { ok: true }
    return { ok: false, reason: 'missing' }
  }
  for (const k of config.keys) if (constantTimeEqual(k, provided)) return { ok: true, keyId: provided }
  return { ok: false, reason: 'invalid' }
}
