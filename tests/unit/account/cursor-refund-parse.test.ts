import { describe, it, expect } from 'vitest'
import { parseRefundResponse } from '../../../src/main/contexts/account/infrastructure/cursor-refund-client'

// tk.sh 的退款接口以若干 `__KCR_KEY__=value` 行返回。这里只测纯解析函数。
describe('parseRefundResponse', () => {
  it('parses a success response with amount + sponsor', () => {
    const text = [
      '__KCR_STATUS__=success',
      '__KCR_AMOUNT__=12.34',
      '__KCR_SPONSOR__=https://kc.example/sponsor',
    ].join('\n')
    expect(parseRefundResponse(text)).toEqual({
      status: 'success',
      amountUsd: '12.34',
      sponsorUrl: 'https://kc.example/sponsor',
    })
  })

  it('parses a pending response', () => {
    const text = '__KCR_STATUS__=pending\n__KCR_AMOUNT__=5.00'
    expect(parseRefundResponse(text)).toEqual({ status: 'pending', amountUsd: '5.00' })
  })

  it('parses already_free with its message', () => {
    const text = '__KCR_STATUS__=already_free\n__KCR_MSG__=账号已是 Free'
    expect(parseRefundResponse(text)).toEqual({
      status: 'already_free',
      message: '账号已是 Free',
    })
  })

  it('parses ratelimited with its message', () => {
    const text = '__KCR_STATUS__=ratelimited\n__KCR_MSG__=请稍后再试'
    expect(parseRefundResponse(text)).toEqual({ status: 'ratelimited', message: '请稍后再试' })
  })

  it('maps an unknown / explicit failed status to failed', () => {
    expect(parseRefundResponse('__KCR_STATUS__=weird\n__KCR_MSG__=boom')).toEqual({
      status: 'failed',
      message: 'boom',
    })
  })

  it('treats an empty body as a failure with a fallback message', () => {
    const out = parseRefundResponse('')
    expect(out.status).toBe('failed')
    expect(out.message).toBeTruthy()
  })

  it('ignores extra/unknown lines and surrounding whitespace', () => {
    const text = ['some banner', '__KCR_STATUS__=success ', '__KCR_AMOUNT__= 9.9 ', 'tail'].join('\n')
    const out = parseRefundResponse(text)
    expect(out.status).toBe('success')
    expect(out.amountUsd).toBe('9.9')
  })
})
