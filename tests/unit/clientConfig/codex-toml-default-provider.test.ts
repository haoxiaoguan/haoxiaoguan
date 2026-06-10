import { describe, it, expect } from 'vitest'
import { parseCodexToml, getCodexDefaultProvider } from '../../../src/main/contexts/clientConfig/infrastructure/codex-toml'

describe('getCodexDefaultProvider', () => {
  it('读顶层 model_provider', () => {
    const obj = parseCodexToml('model_provider = "hxg_abc"\nmodel = "gpt-5.5"\n', 'config.toml')
    expect(getCodexDefaultProvider(obj)).toBe('hxg_abc')
  })
  it('缺失返回 undefined', () => {
    const obj = parseCodexToml('model = "x"\n', 'config.toml')
    expect(getCodexDefaultProvider(obj)).toBeUndefined()
  })
})
