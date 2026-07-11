// 差分测试：断言我们的 TS 移植与 9router open-sse/utils/cursorProtobuf.js 逐字节一致。
// 期望 hex 由 9router 原语在相同输入下产出（拷其源码离线跑一次得到，见 scratchpad/diff-protobuf.mjs）。
// 目的：把「和 9router 对齐」变成永久 CI 断言——任何改动若偏离 9router 的既定 wire 输出即红。
import { describe, it, expect } from 'vitest'
import {
  encodeModel,
  encodeMessage,
  encodeCursorSetting,
  wrapConnectRPCFrame,
} from '../../../src/main/contexts/apiProxy/infrastructure/adapters/cursor/cursor-protobuf'
import { generateCursorChecksum } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/cursor/cursor-checksum'

const hex = (u: Uint8Array): string => Buffer.from(u).toString('hex')

describe('cursor differential vs 9router (byte-for-byte)', () => {
  it('encodeModel matches 9router', () => {
    expect(hex(encodeModel('claude-4.5-sonnet'))).toBe('0a11636c617564652d342e352d736f6e6e65742200')
  })

  it('encodeMessage (user, non-agentic, last) matches 9router', () => {
    expect(hex(encodeMessage('hi', 1, 'fixed-msg-id', null, true, false))).toBe(
      '0a02686910016a0c66697865642d6d73672d6964e80100f80201',
    )
  })

  it('encodeMessage (agentic, last) matches 9router — supported_tools tail present', () => {
    expect(hex(encodeMessage('do', 1, 'mid2', null, true, true))).toBe('0a02646f10016a046d696432e80101f802029a030101')
  })

  it('encodeCursorSetting matches 9router (constant blob)', () => {
    expect(hex(encodeCursorSetting())).toBe('0a11637572736f725c616973657474696e67731a0032040a00120040014801')
  })

  it('wrapConnectRPCFrame matches 9router (5-byte header + payload)', () => {
    expect(hex(wrapConnectRPCFrame(new Uint8Array([97, 98, 99]), false))).toBe('0000000003616263')
  })

  it('generateCursorChecksum matches 9router at a fixed clock', () => {
    // 9router generateCursorChecksum("MID") with Date.now mocked to 1_700_000_000_000 → "Vfb45Bi9MID"
    expect(generateCursorChecksum('MID', () => 1_700_000_000_000)).toBe('Vfb45Bi9MID')
  })
})
