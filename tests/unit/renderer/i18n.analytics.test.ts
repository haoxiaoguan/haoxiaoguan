import { describe, expect, it } from 'vitest'
import enAnalytics from '@/locales/en/analytics.json'
import zhCNAnalytics from '@/locales/zh-CN/analytics.json'

describe('analytics i18n', () => {
  it('为刷新工具栏提供中英文文案', () => {
    expect(enAnalytics.refresh).toBe('Refresh')
    expect(enAnalytics.autoRefresh).toBe('Auto refresh')
    expect(enAnalytics.refreshOff).toBe('Off')
    expect(zhCNAnalytics.refresh).toBe('刷新')
    expect(zhCNAnalytics.autoRefresh).toBe('自动刷新')
    expect(zhCNAnalytics.refreshOff).toBe('关闭')
  })
})
