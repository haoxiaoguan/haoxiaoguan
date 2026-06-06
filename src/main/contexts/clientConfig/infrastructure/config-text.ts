// 配置文本/JSON 合并工具（纯函数）。供各客户端写入器复用：键级合并 JSON、行级合并 .env。
// 核心不变式：只动指定的键、保留用户其余内容；JSON 损坏即抛 ClientConfigCorruptError 拒绝写。
import { ClientConfigCorruptError } from '../domain/client-writer'

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 解析 JSON 对象：null/空 → {}；非对象或解析失败 → 抛 ClientConfigCorruptError（拒绝覆盖损坏文件）。 */
export function parseJsonObject(raw: string | null, file: string): Record<string, unknown> {
  if (raw === null || raw.trim() === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ClientConfigCorruptError(file, `配置文件 JSON 解析失败，拒绝写入：${file}`)
  }
  if (!isObject(parsed)) {
    throw new ClientConfigCorruptError(file, `配置文件不是 JSON 对象，拒绝写入：${file}`)
  }
  return parsed
}

export function stringifyJson(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, null, 2) + '\n'
}

// 容忍可选 `export ` 前缀（捕获到 m[1] 以便替换时保留）；键名在 m[2]。
const ENV_KEY_RE = /^(\s*export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/

/** 行级合并 .env：已存在的键替换其值行，新键追加到末尾；其余行（注释/空行/他键）原样保留。 */
export function upsertEnvLines(raw: string | null, kv: Record<string, string>): string {
  const lines = raw === null || raw === '' ? [] : raw.split('\n')
  const remaining = new Set(Object.keys(kv))
  const out = lines.map((line) => {
    const m = line.match(ENV_KEY_RE)
    if (m !== null && remaining.has(m[2])) {
      remaining.delete(m[2])
      return `${m[1] ?? ''}${m[2]}=${kv[m[2]]}` // 保留原 `export ` 前缀
    }
    return line
  })
  // 去掉尾部空行再追加新键，保持整洁。
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()
  for (const k of Object.keys(kv)) {
    if (remaining.has(k)) out.push(`${k}=${kv[k]}`)
  }
  let res = out.join('\n')
  if (res.length > 0 && !res.endsWith('\n')) res += '\n'
  return res
}

/** 行级移除 .env 中指定键（保留其余行）。 */
export function removeEnvKeys(raw: string | null, keys: string[]): string {
  if (raw === null || raw === '') return ''
  const drop = new Set(keys)
  const out = raw.split('\n').filter((line) => {
    const m = line.match(ENV_KEY_RE)
    return !(m !== null && drop.has(m[2]))
  })
  let res = out.join('\n')
  if (res.length > 0 && !res.endsWith('\n')) res += '\n'
  return res
}
