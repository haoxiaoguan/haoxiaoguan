import { describe, it, expect } from 'vitest'
import {
  noProxyMatches,
  pickProxyFromEnv,
  parseOsProxyResult,
  SystemProxyResolver,
} from '../../../src/main/platform/net/system-proxy'

describe('noProxyMatches', () => {
  it('* 命中全部；精确/子域命中', () => {
    expect(noProxyMatches('q.us-east-1.amazonaws.com', '*')).toBe(true)
    expect(noProxyMatches('amazonaws.com', 'amazonaws.com')).toBe(true)
    expect(noProxyMatches('q.us-east-1.amazonaws.com', '.amazonaws.com')).toBe(true)
    expect(noProxyMatches('q.us-east-1.amazonaws.com', 'example.com,amazonaws.com')).toBe(true)
    expect(noProxyMatches('example.org', 'amazonaws.com')).toBe(false)
  })
})

describe('pickProxyFromEnv', () => {
  it('https 目标取 HTTPS_PROXY，http 取 HTTP_PROXY', () => {
    expect(pickProxyFromEnv('https://q.aws.com', { HTTPS_PROXY: 'http://p:8080' })).toBe('http://p:8080')
    expect(pickProxyFromEnv('http://q.aws.com', { HTTP_PROXY: 'http://p:3128' })).toBe('http://p:3128')
  })
  it('回退 ALL_PROXY；大小写变体', () => {
    expect(pickProxyFromEnv('https://q.aws.com', { ALL_PROXY: 'http://a:1' })).toBe('http://a:1')
    expect(pickProxyFromEnv('https://q.aws.com', { https_proxy: 'http://low:2' })).toBe('http://low:2')
  })
  it('NO_PROXY 命中 → 不用代理', () => {
    expect(pickProxyFromEnv('https://q.amazonaws.com', { HTTPS_PROXY: 'http://p:8080', NO_PROXY: '.amazonaws.com' })).toBeUndefined()
  })
  it('无相关变量 → undefined；非法 URL → undefined', () => {
    expect(pickProxyFromEnv('https://q.aws.com', {})).toBeUndefined()
    expect(pickProxyFromEnv('not a url', { HTTPS_PROXY: 'http://p' })).toBeUndefined()
  })
  it('空白值被忽略', () => {
    expect(pickProxyFromEnv('https://q.aws.com', { HTTPS_PROXY: '   ' })).toBeUndefined()
  })
})

describe('parseOsProxyResult', () => {
  it('DIRECT → undefined', () => {
    expect(parseOsProxyResult('DIRECT')).toBeUndefined()
  })
  it('PROXY host:port → http URL；取首个非 DIRECT', () => {
    expect(parseOsProxyResult('PROXY 10.0.0.1:8080')).toBe('http://10.0.0.1:8080')
    expect(parseOsProxyResult('PROXY 10.0.0.1:8080;DIRECT')).toBe('http://10.0.0.1:8080')
    expect(parseOsProxyResult('DIRECT;PROXY 10.0.0.1:8080')).toBe('http://10.0.0.1:8080')
  })
  it('HTTPS/HTTP scheme → http URL', () => {
    expect(parseOsProxyResult('HTTPS p:443')).toBe('http://p:443')
  })
  it('SOCKS → socks URL（调用方据此降级直连）', () => {
    expect(parseOsProxyResult('SOCKS5 127.0.0.1:1080')).toBe('socks://127.0.0.1:1080')
  })
  it('无法识别 → undefined', () => {
    expect(parseOsProxyResult('')).toBeUndefined()
    expect(parseOsProxyResult('GARBAGE')).toBeUndefined()
  })
})

describe('SystemProxyResolver', () => {
  it('env 优先于 OS 探测', async () => {
    let osCalls = 0
    const r = new SystemProxyResolver({
      env: { HTTPS_PROXY: 'http://env:8080' },
      resolveOsProxy: async () => { osCalls++; return 'PROXY os:9090' },
    })
    expect(await r.resolveUrl('https://q.aws.com')).toBe('http://env:8080')
    expect(osCalls).toBe(0) // env 命中就不调 OS
  })

  it('env 无 → 走 OS 探测', async () => {
    const r = new SystemProxyResolver({
      env: {},
      resolveOsProxy: async () => 'PROXY os:9090',
    })
    expect(await r.resolveUrl('https://q.aws.com')).toBe('http://os:9090')
  })

  it('短缓存：TTL 内不重复探测', async () => {
    let osCalls = 0
    let t = 1000
    const r = new SystemProxyResolver({
      env: {},
      resolveOsProxy: async () => { osCalls++; return 'PROXY os:1' },
      clock: () => t,
      cacheTtlMs: 5000,
    })
    await r.resolveUrl()
    await r.resolveUrl()
    expect(osCalls).toBe(1) // 缓存命中
    t = 7000 // 超 TTL
    await r.resolveUrl()
    expect(osCalls).toBe(2)
  })

  it('OS 探测抛错 → 直连（undefined）', async () => {
    const r = new SystemProxyResolver({
      env: {},
      resolveOsProxy: async () => { throw new Error('scutil fail') },
    })
    expect(await r.resolveUrl()).toBeUndefined()
  })

  it('resolveDispatcher：http 代理 → ProxyAgent；无代理 → undefined；socks → undefined', async () => {
    const httpR = new SystemProxyResolver({ env: { HTTPS_PROXY: 'http://p:8080' } })
    expect(await httpR.resolveDispatcher()).toBeDefined()
    const noneR = new SystemProxyResolver({ env: {} })
    expect(await noneR.resolveDispatcher()).toBeUndefined()
    const socksR = new SystemProxyResolver({ env: { ALL_PROXY: 'socks://127.0.0.1:1080' } })
    expect(await socksR.resolveDispatcher()).toBeUndefined()
  })
})
