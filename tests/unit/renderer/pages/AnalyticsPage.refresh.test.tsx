import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AnalyticsPage from '@/features/analytics/page/AnalyticsPage'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { defaultValue?: string }) => params?.defaultValue ?? key,
  }),
}))

vi.mock('@/features/dashboard/components/DateRangePicker', () => ({
  DateRangePicker: () => <div data-testid="date-range-picker" />,
}))

let usageSyncedCb: (() => void) | null = null

function installBridge() {
  const search = vi.fn(async () => ({ rows: [], nextCursor: undefined }))
  const modelBreakdown = vi.fn(async () => [])
  const onUsageSynced = vi.fn((cb: () => void) => {
    usageSyncedCb = cb
    return () => {
      usageSyncedCb = null
    }
  })

  ;(globalThis as unknown as { api: unknown }).api = {
    analytics: {
      search,
      modelBreakdown,
    },
    system: {
      onUsageSynced,
    },
  }

  return { search, modelBreakdown, onUsageSynced }
}

function renderRequestsPage() {
  return render(
    <MemoryRouter initialEntries={['/analytics/requests']}>
      <AnalyticsPage />
    </MemoryRouter>,
  )
}

describe('AnalyticsPage 刷新', () => {
  beforeEach(() => {
    localStorage.clear()
    usageSyncedCb = null
    vi.restoreAllMocks()
  })

  it('请求日志 tab 在后台 usage 同步完成后重新拉取列表', async () => {
    const fns = installBridge()

    await act(async () => {
      renderRequestsPage()
    })
    await waitFor(() => expect(fns.search).toHaveBeenCalledTimes(1))

    expect(fns.onUsageSynced).toHaveBeenCalledTimes(1)
    expect(usageSyncedCb).toEqual(expect.any(Function))

    fns.search.mockClear()
    await act(async () => {
      usageSyncedCb?.()
    })

    await waitFor(() => expect(fns.search).toHaveBeenCalledTimes(1))
  })

  it('手动刷新按钮只执行一次当前页刷新', async () => {
    const fns = installBridge()

    await act(async () => {
      renderRequestsPage()
    })
    await waitFor(() => expect(fns.search).toHaveBeenCalledTimes(1))

    fns.search.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))

    await waitFor(() => expect(fns.search).toHaveBeenCalledTimes(1))
  })
})
