// redact.ts — 日志脱敏工具（platform 层，无副作用纯函数）。
//
// redactString：字符串级别的正则脱敏，覆盖：
//   - Bearer <token>           → Bearer [REDACTED]
//   - JWT 三段式 <b64>.<b64>.<b64>  → [REDACTED_JWT]
//   - Basic <b64>              → Basic [REDACTED]
//   - inline 键值对 key=value（accessToken/refreshToken/password/secret）
//
// redactValue：对象/数组递归脱敏，敏感键名整体替换为 '[REDACTED]'，
//   maxDepth=6 防止超深递归，WeakSet 防止循环引用，不变异原值。

// 字符串级别匹配规则列表（从最具体到最通用，顺序重要）。
// JWT 三段式必须在 Bearer 规则之前，否则 "Bearer <jwt>" 会先匹配 Bearer 并把整体变成
// "Bearer [REDACTED]"，导致 JWT 三段式不再可见——但实际此处两规则互不干扰：
// Bearer 规则匹配 "Bearer <anything>" 整体，JWT 规则单独匹配三段式，分别替换即可。
// 顺序保持：JWT → Bearer → Basic → inline KV，避免歧义。

// JWT 三段式：header 段必以 eyJ 开头（base64url 编码的 `{"` 前缀，对所有合法 JWT 成立），
// 其余两段为 base64url 字符、每段至少 10 字符（排除普通主机名/调用链/IP 短段误匹配）。
// oidc.eucentral1.amazonaws.com / foo.bar.baz / file.method.call 均不满足 eyJ 前缀→不打码。
const RE_JWT = /\b(eyJ[A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{10,})\.([A-Za-z0-9_-]{10,})\b/g

// Bearer token（token 部分含所有非空白字符；Bearer 自身保留用于诊断）。
const RE_BEARER = /\bBearer\s+\S+/gi

// Basic credential（base64url + padding）。
const RE_BASIC = /\bBasic\s+[A-Za-z0-9+/]+=*/gi

// inline 键值对：key=value（值到空白/逗号/引号/大括号截止，至少 1 字符）。
// 匹配 accessToken / refreshToken / password / secret（大小写不敏感）。
// 格式：key=value 或 "key":"value" 或 key: value（松散匹配，不破坏键名）。
const RE_INLINE_KV =
  /\b(accessToken|refreshToken|password|secret)(["']?\s*[=:]\s*["']?)([^\s,}"']+)/gi

/**
 * 对单个字符串进行脱敏：匹配已知凭据模式并替换占位符。
 * 返回新字符串；原值不变。
 */
export function redactString(s: string): string {
  // 先替换 JWT 三段式（Bearer token 通常是 JWT，先匹配三段式会把内部 JWT 替换掉，
  // 之后 Bearer 规则匹配 "Bearer [REDACTED_JWT]" 并再次替换——为避免双重替换，
  // 将 JWT 规则放在 Bearer 之后，让 Bearer 整体先匹配）。
  // 实际顺序：Bearer → Basic → JWT → inline KV。
  // Bearer 含 JWT 的情形："Bearer eyXxx.eyYyy.zzZzz" → "Bearer [REDACTED]"（整体）。
  // 裸 JWT（无 Bearer 前缀）→ "[REDACTED_JWT]"。
  let out = s
  // Bearer（含 JWT bearer 整体）
  out = out.replace(RE_BEARER, 'Bearer [REDACTED]')
  // Basic
  out = out.replace(RE_BASIC, 'Basic [REDACTED]')
  // 裸 JWT 三段式（Bearer 已处理的不再重复，因为已被替换）
  out = out.replace(RE_JWT, '[REDACTED_JWT]')
  // inline 键值对：保留键名与分隔符，值打码
  out = out.replace(RE_INLINE_KV, '$1$2[REDACTED]')
  return out
}

// 大小写不敏感的敏感键名集合（对象递归脱敏时整体替换值）。
const SENSITIVE_KEYS = new Set([
  'token',
  'accesstoken',
  'refreshtoken',
  'password',
  'secret',
  'authorization',
  'apikey',
  'clientsecret',
])

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase())
}

const MAX_DEPTH = 6

/**
 * 对任意值进行递归脱敏：
 * - 字符串：过 redactString
 * - 数组：每个元素递归（返回新数组）
 * - 对象：敏感键整体替换为 '[REDACTED]'，其余值递归（返回新对象）
 * - 其他原始值：原样返回
 * - 超过 maxDepth 返回 '[Object]'
 * - WeakSet 防循环引用（循环节点返回 '[Circular]'）
 */
export function redactValue(v: unknown, _depth = 0, _seen?: WeakSet<object>): unknown {
  if (_depth > MAX_DEPTH) return '[Object]'

  if (v === null || v === undefined) return v
  if (typeof v === 'string') return redactString(v)
  if (typeof v !== 'object') return v

  const seen = _seen ?? new WeakSet<object>()
  if (seen.has(v as object)) return '[Circular]'
  seen.add(v as object)

  if (Array.isArray(v)) {
    return v.map((item) => redactValue(item, _depth + 1, seen))
  }

  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
    result[key] = isSensitiveKey(key) ? '[REDACTED]' : redactValue(val, _depth + 1, seen)
  }
  return result
}
