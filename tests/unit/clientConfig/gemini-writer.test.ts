import { describe, it, expect } from 'vitest'
import { GeminiWriter } from '../../../src/main/contexts/clientConfig/infrastructure/writers/gemini-writer'
import type { ApplyInput, FileBundle } from '../../../src/main/contexts/clientConfig/domain/client-writer'

const ENV = '/home/u/.gemini/.env'
const SET = '/home/u/.gemini/settings.json'
const w = new GeminiWriter(ENV, SET)

function input(over: Partial<ApplyInput> = {}): ApplyInput {
  return { profileId: 'p1', name: '本机反代', source: 'local-proxy', baseUrl: 'http://127.0.0.1:8788', apiKey: 'k-123', model: 'kiro', ...over }
}

describe('GeminiWriter', () => {
  it('.env 写入三键 + settings.json 设 auth 模式', () => {
    const out = w.renderApply({ [ENV]: null, [SET]: null }, input())
    expect(out[ENV]).toContain('GOOGLE_GEMINI_BASE_URL=http://127.0.0.1:8788')
    expect(out[ENV]).toContain('GEMINI_API_KEY=k-123')
    expect(out[ENV]).toContain('GEMINI_MODEL=kiro')
    const settings = JSON.parse(out[SET]!)
    expect(settings.security.auth.selectedType).toBe('gemini-api-key')
  })

  it('.env 保留用户其余行、替换已存在键', () => {
    const cur: FileBundle = { [ENV]: '# my env\nFOO=bar\nGEMINI_API_KEY=old\n', [SET]: null }
    const out = w.renderApply(cur, input())
    expect(out[ENV]).toContain('# my env')
    expect(out[ENV]).toContain('FOO=bar')
    expect(out[ENV]).toContain('GEMINI_API_KEY=k-123')
    expect(out[ENV]).not.toContain('GEMINI_API_KEY=old')
  })

  it('settings.json 保留用户其余键', () => {
    const cur: FileBundle = { [ENV]: null, [SET]: JSON.stringify({ theme: 'x', security: { other: 1 } }) }
    const settings = JSON.parse(w.renderApply(cur, input())[SET]!)
    expect(settings.theme).toBe('x')
    expect(settings.security.other).toBe(1)
    expect(settings.security.auth.selectedType).toBe('gemini-api-key')
  })

  it('幂等：同输入重复 apply 的 .env 一致', () => {
    const once = w.renderApply({ [ENV]: null, [SET]: null }, input())[ENV]
    const twice = w.renderApply({ [ENV]: once!, [SET]: null }, input())[ENV]
    expect(twice).toBe(once)
  })

  it('clear 只移除 .env 我们的键、保留其余；不动 settings', () => {
    const applied = w.renderApply({ [ENV]: 'FOO=bar\n', [SET]: null }, input())[ENV]
    const out = w.renderClear({ [ENV]: applied! }, 'p1')
    expect(out[ENV]).toContain('FOO=bar')
    expect(out[ENV]).not.toContain('GEMINI_API_KEY')
    expect(SET in out).toBe(false) // settings 不在 clear 输出 → 不改动
  })

  it('切到无 model 的档移除旧 GEMINI_MODEL（switch 语义，修复残留）', () => {
    const cur: FileBundle = { [ENV]: 'GEMINI_MODEL=old\nFOO=bar\n', [SET]: null }
    const out = w.renderApply(cur, input({ model: undefined }))
    expect(out[ENV]).not.toContain('GEMINI_MODEL')
    expect(out[ENV]).toContain('FOO=bar')
  })

  it('export 前缀的已存在键被替换而非重复', () => {
    const out = w.renderApply({ [ENV]: 'export GEMINI_API_KEY=old\n', [SET]: null }, input())
    const keyLines = out[ENV]!.split('\n').filter((l) => l.includes('GEMINI_API_KEY'))
    expect(keyLines).toHaveLength(1)
    expect(out[ENV]).toContain('GEMINI_API_KEY=k-123')
    expect(out[ENV]).not.toContain('old')
  })

  it('clear 能移除 export 前缀的旧键', () => {
    const out = w.renderClear({ [ENV]: 'export GEMINI_API_KEY=old\nFOO=bar\n' }, 'p1')
    expect(out[ENV]).not.toContain('GEMINI_API_KEY')
    expect(out[ENV]).toContain('FOO=bar')
  })
})
