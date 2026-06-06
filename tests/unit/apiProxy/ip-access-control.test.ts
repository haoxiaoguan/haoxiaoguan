import { describe, it, expect } from 'vitest'
import { parseCidr, isIpAllowed } from '../../../src/main/contexts/apiProxy/domain/ip-access-control'

describe('parseCidr', () => {
  it('解析 IPv4 CIDR 与裸 IP（裸 IP=/32）', () => {
    expect(parseCidr('10.0.0.0/8')).not.toBeNull()
    expect(parseCidr('192.168.1.1')).toMatchObject({ version: 4, prefix: 32 })
    expect(parseCidr('  10.0.0.0/8  ')).not.toBeNull() // trim
  })
  it('解析 IPv6 CIDR（含 :: 压缩、裸=/128）', () => {
    expect(parseCidr('fd00::/8')).toMatchObject({ version: 6, prefix: 8 })
    expect(parseCidr('::1')).toMatchObject({ version: 6, prefix: 128 })
    expect(parseCidr('2001:db8::/32')).not.toBeNull()
  })
  it('非法输入返回 null', () => {
    expect(parseCidr('')).toBeNull()
    expect(parseCidr('999.1.1.1')).toBeNull()
    expect(parseCidr('10.0.0.0/33')).toBeNull()
    expect(parseCidr('foo')).toBeNull()
    expect(parseCidr('2001:db8::/129')).toBeNull()
    expect(parseCidr('1::2::3')).toBeNull()
  })
})

describe('isIpAllowed', () => {
  it('白黑名单皆空 → 放行全部', () => {
    expect(isIpAllowed('1.2.3.4', '', '')).toBe(true)
    expect(isIpAllowed(undefined, '', '')).toBe(true)
  })

  it('IPv4 黑名单优先（命中即拒）', () => {
    expect(isIpAllowed('192.168.1.5', '', '192.168.1.0/24')).toBe(false)
    expect(isIpAllowed('10.0.0.5', '', '192.168.1.0/24')).toBe(true) // 不在黑名单
  })

  it('IPv4 白名单非空 → 必须命中', () => {
    expect(isIpAllowed('10.1.2.3', '10.0.0.0/8', '')).toBe(true)
    expect(isIpAllowed('192.168.1.1', '10.0.0.0/8', '')).toBe(false) // 不在白名单
  })

  it('黑名单先于白名单（即使在白名单也拒）', () => {
    expect(isIpAllowed('10.0.0.5', '10.0.0.0/8', '10.0.0.5')).toBe(false)
    expect(isIpAllowed('10.0.0.6', '10.0.0.0/8', '10.0.0.5')).toBe(true)
  })

  it('多条 CIDR（逗号/换行分隔）', () => {
    expect(isIpAllowed('172.16.0.9', '10.0.0.0/8,172.16.0.0/12', '')).toBe(true)
    expect(isIpAllowed('172.16.0.9', '10.0.0.0/8\n172.16.0.0/12', '')).toBe(true)
    expect(isIpAllowed('8.8.8.8', '10.0.0.0/8\n172.16.0.0/12', '')).toBe(false)
  })

  it('IPv4-mapped IPv6（::ffff:）当作 IPv4 匹配', () => {
    expect(isIpAllowed('::ffff:10.0.0.5', '10.0.0.0/8', '')).toBe(true)
    expect(isIpAllowed('::ffff:192.168.0.1', '10.0.0.0/8', '')).toBe(false)
  })

  it('IPv6 CIDR 匹配 + 回环 ::1', () => {
    expect(isIpAllowed('::1', '::1/128', '')).toBe(true)
    expect(isIpAllowed('fd00::1234', 'fd00::/8', '')).toBe(true)
    expect(isIpAllowed('2001:db8::1', 'fd00::/8', '')).toBe(false)
  })

  it('配置了规则但 remote 缺失/非法 → fail-closed 拒绝', () => {
    expect(isIpAllowed(undefined, '10.0.0.0/8', '')).toBe(false)
    expect(isIpAllowed('not-an-ip', '10.0.0.0/8', '')).toBe(false)
    expect(isIpAllowed(undefined, '', '10.0.0.0/8')).toBe(false)
  })

  it('非法名单项被丢弃（不影响合法项判定）', () => {
    expect(isIpAllowed('10.0.0.5', 'garbage,10.0.0.0/8', '')).toBe(true)
    expect(isIpAllowed('10.0.0.5', 'garbage', '')).toBe(true) // 全非法=白名单空=放行
  })
})
