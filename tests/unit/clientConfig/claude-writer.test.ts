import { describe, it, expect } from 'vitest'
import { ClaudeWriter } from '../../../src/main/contexts/clientConfig/infrastructure/writers/claude-writer'
import { ClientConfigCorruptError, type ApplyInput, type FileBundle } from '../../../src/main/contexts/clientConfig/domain/client-writer'

const P = '/home/u/.claude/settings.json'
const w = new ClaudeWriter(P)

function input(over: Partial<ApplyInput> = {}): ApplyInput {
  return { profileId: 'p1', name: '本机反代', source: 'local-proxy', baseUrl: 'http://127.0.0.1:8788', apiKey: 'sk-hxg-abc', model: 'kiro', ...over }
}
function applyParsed(current: FileBundle, inp = input()): any {
  return JSON.parse(w.renderApply(current, inp)[P]!)
}

describe('ClaudeWriter', () => {
  it('空文件 → 写入 env 三键', () => {
    const o = applyParsed({ [P]: null })
    expect(o.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:8788')
    expect(o.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-hxg-abc')
    expect(o.env.ANTHROPIC_MODEL).toBe('kiro')
  })

  it('保留用户其余顶层键与 env 变量', () => {
    const cur = { [P]: JSON.stringify({ theme: 'dark', env: { FOO: 'bar', ANTHROPIC_BASE_URL: 'old' } }) }
    const o = applyParsed(cur)
    expect(o.theme).toBe('dark')
    expect(o.env.FOO).toBe('bar')
    expect(o.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:8788') // 覆盖旧值
  })

  it('无 model → 不写 ANTHROPIC_MODEL', () => {
    const o = applyParsed({ [P]: null }, input({ model: undefined }))
    expect('ANTHROPIC_MODEL' in o.env).toBe(false)
  })

  it('幂等：同输入重复 apply 结果一致', () => {
    const once = w.renderApply({ [P]: null }, input())[P]
    const twice = w.renderApply({ [P]: once! }, input())[P]
    expect(twice).toBe(once)
  })

  it('clear 移除我们的键、保留用户 env', () => {
    const applied = w.renderApply({ [P]: JSON.stringify({ env: { FOO: 'bar' } }) }, input())[P]
    const cleared = JSON.parse(w.renderClear({ [P]: applied! }, 'p1')[P]!)
    expect('ANTHROPIC_BASE_URL' in cleared.env).toBe(false)
    expect('ANTHROPIC_AUTH_TOKEN' in cleared.env).toBe(false)
    expect(cleared.env.FOO).toBe('bar')
  })

  it('损坏 JSON → 抛 ClientConfigCorruptError，拒绝覆盖', () => {
    expect(() => w.renderApply({ [P]: '{ not json' }, input())).toThrow(ClientConfigCorruptError)
  })
})
