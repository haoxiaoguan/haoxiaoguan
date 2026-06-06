// IP 访问控制（G5）——CIDR 白/黑名单 bitwise 匹配，纯函数无副作用。
// IPv4（a.b.c.d[/n]，无 /n 视作 /32）与 IPv6（含 :: 压缩、内嵌 IPv4、::ffff: 映射）。
// 判定取连接的 socket.remoteAddress（**不信任 X-Forwarded-For**）。
//
// 策略：黑名单优先（命中即拒）；白名单非空时必须命中；二者皆空=不限制（放行全部）。
// 取不到/解析不出 remote 且配置了任一规则 → fail-closed 拒绝。

interface Cidr {
  version: 4 | 6
  /** 网络号（已按 prefix 掩码归一）。 */
  base: bigint
  prefix: number
}

interface ParsedIp {
  version: 4 | 6
  value: bigint
}

// IPv4 点分十进制 → 32 位整数；非法返回 null。
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const b = Number(p)
    if (b > 255) return null
    n = (n << 8) | b
  }
  return n >>> 0
}

// IPv6 → 128 位 BigInt；支持 :: 压缩、内嵌 IPv4（::ffff:1.2.3.4 等）、%zone 后缀。非法返回 null。
function ipv6ToBigInt(input: string): bigint | null {
  let ip = input
  const pct = ip.indexOf('%')
  if (pct >= 0) ip = ip.slice(0, pct)
  // 内嵌 IPv4：把末段点分十进制转成两个 hextet。
  if (ip.includes('.')) {
    const lastColon = ip.lastIndexOf(':')
    if (lastColon < 0) return null
    const v4 = ipv4ToInt(ip.slice(lastColon + 1))
    if (v4 === null) return null
    const hi = (v4 >>> 16) & 0xffff
    const lo = v4 & 0xffff
    ip = ip.slice(0, lastColon + 1) + hi.toString(16) + ':' + lo.toString(16)
  }
  const halves = ip.split('::')
  if (halves.length > 2) return null
  const parse = (s: string): string[] => (s === '' ? [] : s.split(':'))
  const head = parse(halves[0])
  const tail = halves.length === 2 ? parse(halves[1]) : []
  let groups: string[]
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length
    if (missing < 1) return null // :: 必须至少压缩 1 组
    groups = [...head, ...Array<string>(missing).fill('0'), ...tail]
  } else {
    groups = head
  }
  if (groups.length !== 8) return null
  let n = 0n
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null
    n = (n << 16n) | BigInt(parseInt(g, 16))
  }
  return n
}

// 前 prefix 位为 1、其余为 0 的掩码（bits=32 或 128）。
function maskBig(prefix: number, bits: number): bigint {
  if (prefix <= 0) return 0n
  const full = (1n << BigInt(bits)) - 1n
  if (prefix >= bits) return full
  const hostBits = BigInt(bits - prefix)
  return (full >> hostBits) << hostBits
}

// 去掉 ::ffff: IPv4 映射前缀与 %zone，便于把映射地址当作 IPv4 处理。
function normalizeRemote(ip: string): string {
  let r = ip.trim()
  const pct = r.indexOf('%')
  if (pct >= 0) r = r.slice(0, pct)
  if (r.toLowerCase().startsWith('::ffff:') && r.includes('.')) r = r.slice(7)
  return r
}

/** 解析单条 CIDR（或裸 IP）；非法返回 null。 */
export function parseCidr(input: string): Cidr | null {
  const s = input.trim()
  if (s.length === 0) return null
  const slash = s.indexOf('/')
  const addr = slash >= 0 ? s.slice(0, slash) : s
  const prefixStr = slash >= 0 ? s.slice(slash + 1) : ''

  const v4 = ipv4ToInt(addr)
  if (v4 !== null) {
    const prefix = prefixStr === '' ? 32 : Number(prefixStr)
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null
    return { version: 4, base: BigInt(v4) & maskBig(prefix, 32), prefix }
  }
  const v6 = ipv6ToBigInt(addr)
  if (v6 !== null) {
    const prefix = prefixStr === '' ? 128 : Number(prefixStr)
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) return null
    return { version: 6, base: v6 & maskBig(prefix, 128), prefix }
  }
  return null
}

function parseIp(ip: string): ParsedIp | null {
  const norm = normalizeRemote(ip)
  const v4 = ipv4ToInt(norm)
  if (v4 !== null) return { version: 4, value: BigInt(v4) }
  const v6 = ipv6ToBigInt(norm)
  if (v6 !== null) return { version: 6, value: v6 }
  return null
}

function ipInCidr(parsed: ParsedIp, cidr: Cidr): boolean {
  if (parsed.version !== cidr.version) return false
  const bits = cidr.version === 4 ? 32 : 128
  return (parsed.value & maskBig(cidr.prefix, bits)) === cidr.base
}

/** 逗号或换行分隔 → CIDR 列表（丢弃空串与非法项）。 */
export function parseCidrList(str: string): Cidr[] {
  return str
    .split(/[\n,]/)
    .map((s) => parseCidr(s))
    .filter((c): c is Cidr => c !== null)
}

/**
 * 判定远端 IP 是否放行。
 * - 白/黑名单皆空 → 放行（不限制）。
 * - 配了规则但 remote 取不到/解析失败 → 拒绝（fail-closed）。
 * - 命中黑名单 → 拒绝（黑名单优先）。
 * - 白名单非空 → 必须命中其一才放行；白名单空（仅黑名单）→ 未命中黑名单即放行。
 */
export function isIpAllowed(
  remote: string | undefined,
  allowlistStr: string,
  denylistStr: string,
): boolean {
  const deny = parseCidrList(denylistStr)
  const allow = parseCidrList(allowlistStr)
  if (deny.length === 0 && allow.length === 0) return true

  const parsed = remote !== undefined ? parseIp(remote) : null
  if (parsed === null) return false

  if (deny.some((c) => ipInCidr(parsed, c))) return false
  if (allow.length > 0) return allow.some((c) => ipInCidr(parsed, c))
  return true
}
