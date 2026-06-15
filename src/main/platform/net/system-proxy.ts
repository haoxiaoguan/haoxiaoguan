// OS 系统代理探测（G7）——当账号/组均无代理绑定时的出站兜底。
//
// 背景：undici / Electron 的 fetch **默认不读** HTTP(S)_PROXY 环境变量（不同于 curl），
// 也不跟随 OS 代理设置。本模块在「无账号/组代理」时按以下优先级解析代理：
//   1. 环境变量 HTTPS_PROXY/HTTP_PROXY/ALL_PROXY（尊重 NO_PROXY 排除）——纯函数、可测、跨平台。
//   2. 注入的 OS 探测器（容器接 Electron session.resolveProxy；含 macOS 系统设置/Win 注册表/PAC）。
// 命中则构造 undici ProxyAgent（http CONNECT 代理）；socks 暂不支持→直连。短缓存避免频繁探测。
import { ProxyAgent, type Dispatcher } from 'undici'

// 解析代理用的代表性目标（出站均到 AWS；代理选择极少按 region 区分，固定一个即可）。
const DEFAULT_TARGET = 'https://q.us-east-1.amazonaws.com'

/** NO_PROXY 是否命中该 host（逗号分隔；`*`=全部；`.foo`/`foo` 匹配 host 或其子域）。 */
export function noProxyMatches(host: string, noProxy: string): boolean {
  const entries = noProxy.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
  if (entries.includes('*')) return true
  const h = host.toLowerCase()
  return entries.some((e) => {
    const x = e.toLowerCase().replace(/^\./, '')
    return h === x || h.endsWith('.' + x)
  })
}

/** 从环境变量挑代理 URL（https 目标用 HTTPS_PROXY，http 用 HTTP_PROXY，均回退 ALL_PROXY）。 */
export function pickProxyFromEnv(targetUrl: string, env: NodeJS.ProcessEnv): string | undefined {
  let host: string
  let isHttps: boolean
  try {
    const u = new URL(targetUrl)
    host = u.hostname
    isHttps = u.protocol === 'https:'
  } catch {
    return undefined
  }
  const noProxy = env.NO_PROXY ?? env.no_proxy ?? ''
  if (noProxy.length > 0 && noProxyMatches(host, noProxy)) return undefined
  const pick = (...names: string[]): string | undefined => {
    for (const n of names) {
      const v = env[n]
      if (v !== undefined && v.trim().length > 0) return v.trim()
    }
    return undefined
  }
  return isHttps
    ? pick('HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy')
    : pick('HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy')
}

/**
 * 解析 Electron session.resolveProxy 的 PAC 风格返回串 → 代理 URL。
 * 形如 "DIRECT" | "PROXY host:port" | "PROXY h:p;DIRECT" | "SOCKS5 host:port"。
 * 取首个非 DIRECT 项；PROXY/HTTP(S)→http://；SOCKS→socks://（调用方暂不支持 socks）。
 */
export function parseOsProxyResult(pac: string): string | undefined {
  for (const part of pac.split(';').map((s) => s.trim())) {
    if (part === 'DIRECT' || part.length === 0) continue
    const m = part.match(/^(PROXY|HTTPS?|SOCKS5?)\s+(\S+)$/i)
    if (m === null) continue
    const scheme = m[1].toUpperCase()
    const hostport = m[2]
    if (scheme.startsWith('SOCKS')) return `socks://${hostport}`
    return `http://${hostport}`
  }
  return undefined
}

export interface SystemProxyOpts {
  /** 注入环境（测试用），默认 process.env。 */
  env?: NodeJS.ProcessEnv
  /** 注入 OS 探测器（容器接 Electron session.resolveProxy），返回原始 PAC 串；不传则跳过 OS 探测。 */
  resolveOsProxy?: (targetUrl: string) => Promise<string | undefined>
  /** 注入时钟（测试用），默认 Date.now。 */
  clock?: () => number
  /** 缓存 TTL（ms），默认 30s。 */
  cacheTtlMs?: number
}

export class SystemProxyResolver {
  private readonly env: NodeJS.ProcessEnv
  private readonly resolveOsProxy?: ((targetUrl: string) => Promise<string | undefined>) | undefined
  private readonly clock: () => number
  private readonly ttl: number
  private cached: { url: string | undefined; at: number } | null = null

  constructor(opts: SystemProxyOpts = {}) {
    this.env = opts.env ?? process.env
    this.resolveOsProxy = opts.resolveOsProxy
    this.clock = opts.clock ?? Date.now
    this.ttl = opts.cacheTtlMs ?? 30_000
  }

  /** 解析系统代理 URL（env 优先，再 OS 探测）。短缓存。无则 undefined（直连）。 */
  async resolveUrl(targetUrl: string = DEFAULT_TARGET): Promise<string | undefined> {
    const now = this.clock()
    if (this.cached !== null && now - this.cached.at < this.ttl) return this.cached.url
    let url = pickProxyFromEnv(targetUrl, this.env)
    if (url === undefined && this.resolveOsProxy !== undefined) {
      try {
        const pac = await this.resolveOsProxy(targetUrl)
        if (pac !== undefined && pac.length > 0) url = parseOsProxyResult(pac)
      } catch {
        // OS 探测失败 → 直连
      }
    }
    this.cached = { url, at: now }
    return url
  }

  /** 解析为 undici Dispatcher（仅 http(s) CONNECT 代理；socks 暂不支持 → undefined 直连）。 */
  async resolveDispatcher(targetUrl: string = DEFAULT_TARGET): Promise<Dispatcher | undefined> {
    const url = await this.resolveUrl(targetUrl)
    if (url === undefined || url.startsWith('socks')) return undefined
    try {
      return new ProxyAgent(url)
    } catch {
      return undefined
    }
  }
}
