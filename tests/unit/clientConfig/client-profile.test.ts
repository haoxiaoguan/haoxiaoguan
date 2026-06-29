import { describe, it, expect } from 'vitest'
import {
  CLIENT_WRITE_MODE,
  CLIENT_IDS,
  CLIENT_DISPLAY_NAMES,
} from '../../../src/main/contexts/clientConfig/domain/client-profile'

describe('CLIENT_WRITE_MODE', () => {
  it('codex/opencode/openclaw/hermes 为 additive(共存)', () => {
    expect(CLIENT_WRITE_MODE.codex).toBe('additive')
    expect(CLIENT_WRITE_MODE.opencode).toBe('additive')
    expect(CLIENT_WRITE_MODE.openclaw).toBe('additive')
    expect(CLIENT_WRITE_MODE.hermes).toBe('additive')
  })
  it('claude/claude_desktop/gemini_cli 为 switch', () => {
    expect(CLIENT_WRITE_MODE.claude).toBe('switch')
    expect(CLIENT_WRITE_MODE.claude_desktop).toBe('switch')
    expect(CLIENT_WRITE_MODE.gemini_cli).toBe('switch')
  })
  it('每个客户端都有写入模式与显示名', () => {
    for (const id of CLIENT_IDS) {
      expect(CLIENT_WRITE_MODE[id]).toMatch(/^(switch|additive)$/)
      expect(CLIENT_DISPLAY_NAMES[id]).toBeTruthy()
    }
  })
})
