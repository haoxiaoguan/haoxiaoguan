// Cursor 鉴权头构造（忠实移植自 9router open-sse/utils/cursorChecksum.js）。
//
// x-cursor-checksum 是 Cursor 上游必需的时间型鉴权（Jyh cipher）；另派生 x-client-key(SHA256(token))、
// x-session-id(uuidv5(token))。checksum 的字节输出被上游校验，**逐行照抄勿"优化"**——包括 9router 里
// `timestamp >> 40`（JS 位运算取低 5 位移位数，实际等价 `>> 8`）这类既定行为，必须原样复刻。
//
// 与 9router 的差异：Date.now / randomUUID / 时区改为可注入（CursorHeaderDeps），默认真实值，运行时一致，
// 单测注入固定值即可断言确定输出。本项目无 uuid 包，故内联实现 uuidv5（RFC 4122，SHA-1 命名空间）。
import { createHash, randomUUID } from 'node:crypto'

/** uuid 包的 DNS 命名空间常量（uuidv5.DNS）。 */
const DNS_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

/** SHA-256 hex（对齐 9router generateHashed64Hex）。 */
export function generateHashed64Hex(input: string, salt = ''): string {
  return createHash('sha256')
    .update(input + salt)
    .digest('hex')
}

/** UUID 字符串 → 16 字节。 */
function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '')
  return Buffer.from(hex, 'hex')
}

/** 16 字节 → UUID 字符串。 */
function bytesToUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * uuidv5（RFC 4122，SHA-1）——与 npm uuid 包的 v5 行为一致：
 * hash = SHA1(namespaceBytes ++ nameBytes)，取前 16 字节，置 version=5、variant=RFC4122。
 */
export function uuidv5(name: string, namespace: string = DNS_NAMESPACE): string {
  const nsBytes = uuidToBytes(namespace)
  const nameBytes = Buffer.from(name, 'utf8')
  const hash = createHash('sha1')
    .update(Buffer.concat([nsBytes, nameBytes]))
    .digest()
  const bytes = Buffer.from(hash.subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0f) | 0x50 // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant RFC4122
  return bytesToUuid(bytes)
}

/** session id = uuidv5(token, DNS)（确定性，纯 token 派生）。 */
export function generateSessionId(authToken: string): string {
  return uuidv5(authToken, DNS_NAMESPACE)
}

/**
 * Cursor checksum（Jyh cipher）。逐行照抄 9router：
 * 1. timestamp = floor(now / 1e6)
 * 2. 拼 6 字节数组（注意 JS `>>` 位移语义，勿改）
 * 3. Jyh 混淆：byteArray[i] = ((byteArray[i] ^ t) + (i % 256)) & 0xFF; t = byteArray[i]
 * 4. URL-safe base64（自定义字母表，无填充）
 * 5. 拼 machineId（无逗号分隔）
 */
export function generateCursorChecksum(machineId: string, now: () => number = Date.now): string {
  const timestamp = Math.floor(now() / 1000000)

  const byteArray = new Uint8Array([
    (timestamp >> 40) & 0xff,
    (timestamp >> 32) & 0xff,
    (timestamp >> 24) & 0xff,
    (timestamp >> 16) & 0xff,
    (timestamp >> 8) & 0xff,
    timestamp & 0xff,
  ])

  let t = 165
  for (let i = 0; i < byteArray.length; i++) {
    byteArray[i] = ((byteArray[i] ^ t) + (i % 256)) & 0xff
    t = byteArray[i]
  }

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let encoded = ''

  for (let i = 0; i < byteArray.length; i += 3) {
    const a = byteArray[i]
    const b = i + 1 < byteArray.length ? byteArray[i + 1] : 0
    const c = i + 2 < byteArray.length ? byteArray[i + 2] : 0

    encoded += alphabet[a >> 2]
    encoded += alphabet[((a & 3) << 4) | (b >> 4)]

    if (i + 1 < byteArray.length) {
      encoded += alphabet[((b & 15) << 2) | (c >> 6)]
    }
    if (i + 2 < byteArray.length) {
      encoded += alphabet[c & 63]
    }
  }

  return `${encoded}${machineId}`
}

// 逆向自 Cursor 3.11.13 bundle（storage.json product.json，2026-07 真机核对）。9router 的 3.1.0 已过时。
// 版本非强制门（真机实测 99.0.0 也被处理），但用真实值让请求更像正规客户端、降低风控。
const DEFAULT_CLIENT_VERSION = '3.11.13'
const DEFAULT_CLIENT_COMMIT = '3f21b08f0b436a07be29fbfe00b304fa15553350'

export interface CursorHeaderDeps {
  /** 当前时间（ms）；默认 Date.now。喂 checksum 时间戳。 */
  now?: () => number
  /** 生成 x-request-id / x-amzn-trace-id / x-cursor-config-version 的 UUID；默认 randomUUID。 */
  genUuid?: () => string
  /** 时区（x-cursor-timezone）；默认取运行环境时区。 */
  timezone?: string
  /**
   * Mac 专属第二机器 ID（storage.json telemetry.macMachineId）。提供时 checksum 变为
   * `${base64}${machineId}/${macMachineId}`（对齐 cursor 真实客户端 macOS 格式）。
   */
  macMachineId?: string
  /** 客户端版本（storage.json product.json version）；默认最近已知值。 */
  clientVersion?: string
  /** 客户端 commit（product.json commit）；默认最近已知值。 */
  clientCommit?: string
  /** 客户端 OS 版本（x-cursor-client-os-version）。 */
  osVersion?: string
}

/** token 去前缀（user_xxx::JWT → JWT）。 */
export function cleanCursorToken(accessToken: string): string {
  return accessToken.includes('::') ? accessToken.split('::')[1] : accessToken
}

function detectOs(): string {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'macos'
  return 'linux'
}

function detectArch(): string {
  return process.arch === 'arm64' ? 'aarch64' : 'x64'
}

function resolveTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * 构造 Cursor API 全套请求头。
 * @param accessToken 原始 token（可含 user_xxx:: 前缀，内部去除）
 * @param machineId 机器 ID；缺省则派生 SHA256(cleanToken+'machineId')（风控接受度待真机验证）
 * @param ghostMode 隐私模式，默认 true
 */
export function buildCursorHeaders(
  accessToken: string,
  machineId: string | null = null,
  ghostMode = true,
  deps: CursorHeaderDeps = {},
): Record<string, string> {
  const now = deps.now ?? Date.now
  const genUuid = deps.genUuid ?? randomUUID
  const timezone = deps.timezone ?? resolveTimezone()

  const cleanToken = cleanCursorToken(accessToken)
  const effectiveMachineId = machineId || generateHashed64Hex(cleanToken, 'machineId')

  const sessionId = generateSessionId(cleanToken)
  const clientKey = generateHashed64Hex(cleanToken)
  // macOS 真实客户端格式：checksum 后缀 `${machineId}/${macMachineId}`（有 macMachineId 时）。
  const checksumArg = deps.macMachineId ? `${effectiveMachineId}/${deps.macMachineId}` : effectiveMachineId
  const checksum = generateCursorChecksum(checksumArg, now)

  const headers: Record<string, string> = {
    authorization: `Bearer ${cleanToken}`,
    'connect-accept-encoding': 'gzip',
    'connect-protocol-version': '1',
    'content-type': 'application/connect+proto',
    'user-agent': 'connect-es/1.6.1',
    'x-amzn-trace-id': `Root=${genUuid()}`,
    'x-client-key': clientKey,
    'x-cursor-checksum': checksum,
    'x-cursor-client-version': deps.clientVersion ?? DEFAULT_CLIENT_VERSION,
    'x-cursor-client-commit': deps.clientCommit ?? DEFAULT_CLIENT_COMMIT,
    'x-cursor-client-type': 'ide',
    'x-cursor-client-os': detectOs(),
    'x-cursor-client-arch': detectArch(),
    'x-cursor-client-device-type': 'desktop',
    'x-cursor-config-version': genUuid(),
    'x-cursor-timezone': timezone,
    'x-ghost-mode': ghostMode ? 'true' : 'false',
    'x-request-id': genUuid(),
    'x-session-id': sessionId,
  }
  if (deps.osVersion !== undefined && deps.osVersion.length > 0) {
    headers['x-cursor-client-os-version'] = deps.osVersion
  }
  return headers
}
