import { describe, it, expect } from 'vitest'
import {
  parseTimestampToMs,
  extractText,
  truncateSummary,
  pathBasename,
  sanitizeSessionId,
} from '../../../src/main/contexts/sessions/domain/session-parse-utils'

describe('parseTimestampToMs', () => {
  it('RFC3339 字符串 → 毫秒', () => {
    expect(parseTimestampToMs('2026-06-04T07:11:01.858Z')).toBe(Date.parse('2026-06-04T07:11:01.858Z'))
  })
  it('秒级数字 ×1000，毫秒级原样', () => {
    expect(parseTimestampToMs(1_700_000_000)).toBe(1_700_000_000_000)
    expect(parseTimestampToMs(1_700_000_000_000)).toBe(1_700_000_000_000)
  })
  it('非法 → undefined', () => {
    expect(parseTimestampToMs('nope')).toBeUndefined()
    expect(parseTimestampToMs(undefined)).toBeUndefined()
    expect(parseTimestampToMs(null)).toBeUndefined()
  })
})

describe('extractText', () => {
  it('字符串原样', () => {
    expect(extractText('hello')).toBe('hello')
  })
  it('数组拍平，tool_use → [Tool: name]，过滤空段', () => {
    const content = [
      { type: 'text', text: 'a' },
      { type: 'tool_use', name: 'Read', input: {} },
      { type: 'other' },
    ]
    expect(extractText(content)).toBe('a\n[Tool: Read]')
  })
  it('tool_result 取嵌套 content', () => {
    expect(extractText([{ type: 'tool_result', content: 'ok' }])).toBe('ok')
  })
  it('对象取 text；input_text/output_text 兜底', () => {
    expect(extractText({ text: 'x' })).toBe('x')
    expect(extractText([{ type: 'message', input_text: 'in' }])).toBe('in')
    expect(extractText([{ type: 'message', output_text: 'out' }])).toBe('out')
  })
})

describe('truncateSummary', () => {
  it('按字符截断并追加 ...', () => {
    expect(truncateSummary('  abc  ', 10)).toBe('abc')
    expect(truncateSummary('abcdef', 3)).toBe('abc...')
  })
  it('按 code point 截断（不切坏多字节）', () => {
    expect(truncateSummary('你好世界', 2)).toBe('你好...')
  })
  it('空白 → 空串', () => {
    expect(truncateSummary('   ', 5)).toBe('')
  })
})

describe('pathBasename', () => {
  it('取末段，去尾部分隔符', () => {
    expect(pathBasename('/a/b/c/')).toBe('c')
    expect(pathBasename('C:\\\\x\\\\y')).toBe('y')
  })
})

describe('sanitizeSessionId', () => {
  it('放行常规 id 字符', () => {
    expect(sanitizeSessionId('019e9178-9e3c-7183.ab_CD')).toBe('019e9178-9e3c-7183.ab_CD')
  })
  it('剔除危险字符', () => {
    expect(sanitizeSessionId('a b;rm -rf/')).toBe('abrm-rf')
  })
  it('纯标点（如 ..）返回空串', () => {
    expect(sanitizeSessionId('../')).toBe('')
    expect(sanitizeSessionId('..')).toBe('')
  })
})
