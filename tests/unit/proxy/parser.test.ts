import { describe, it, expect } from 'vitest'
import { parseProxyLine, parseProxyLines } from '../../../src/main/contexts/proxy/domain/proxy-parser'

describe('parseProxyLine', () => {
  it('parses host:port', () => {
    const r = parseProxyLine('1.2.3.4:8080')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toMatchObject({
      protocol: 'http',
      host: '1.2.3.4',
      port: 8080,
    })
    expect(r.value.username).toBeUndefined()
    expect(r.value.password).toBeUndefined()
  })

  it('parses host:port:user:pass', () => {
    const r = parseProxyLine('1.2.3.4:8080:alice:s3cret')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toMatchObject({
      protocol: 'http',
      host: '1.2.3.4',
      port: 8080,
      username: 'alice',
      password: 's3cret',
    })
  })

  it('parses a password containing colons in host:port:user:pass', () => {
    const r = parseProxyLine('1.2.3.4:8080:alice:a:b:c')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.password).toBe('a:b:c')
  })

  it('parses scheme://user:pass@host:port', () => {
    const r = parseProxyLine('socks5://bob:pw@example.com:1080')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toMatchObject({
      protocol: 'socks5',
      host: 'example.com',
      port: 1080,
      username: 'bob',
      password: 'pw',
    })
  })

  it('parses scheme://host:port with no auth', () => {
    const r = parseProxyLine('https://proxy.local:3128')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toMatchObject({
      protocol: 'https',
      host: 'proxy.local',
      port: 3128,
      username: undefined,
    })
  })

  it('rejects an out-of-range port', () => {
    const r = parseProxyLine('1.2.3.4:70000')
    expect(r.ok).toBe(false)
  })

  it('rejects a non-numeric port', () => {
    const r = parseProxyLine('1.2.3.4:abc')
    expect(r.ok).toBe(false)
  })

  it('rejects an unknown scheme', () => {
    const r = parseProxyLine('ftp://1.2.3.4:21')
    expect(r.ok).toBe(false)
  })

  it('rejects a blank/garbage line', () => {
    expect(parseProxyLine('nonsense').ok).toBe(false)
  })
})

describe('parseProxyLines', () => {
  it('skips blank and comment lines, summarises ok/failed', () => {
    const text = [
      '# a comment',
      '',
      '1.2.3.4:8080',
      '   ',
      'socks5://bob:pw@example.com:1080',
      'garbage-line',
      '// another comment',
    ].join('\n')
    const result = parseProxyLines(text)
    expect(result.parsed).toHaveLength(2)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]).toMatchObject({ lineNumber: 6, raw: 'garbage-line' })
  })
})
