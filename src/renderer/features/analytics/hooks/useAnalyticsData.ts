import { useEffect, useState, useCallback, useRef } from 'react'

/**
 * 通用数据获取 hook（项目无 react-query，用 useState + useEffect）。
 * 自动在依赖变化时重新拉取，支持手动 refresh。
 *
 * 防闪烁：依赖变化时后台静默重拉（不把 loading 设回 true，保留旧数据显示），
 * 仅在首次加载时显示 loading。fetcher 引用不进 effect 依赖
 * （用 ref 持有最新 fetcher，effect 只看 deps + nonce）。
 */
export function useAnalyticsData<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
): { data: T | null; loading: boolean; error: string | null; refresh: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  // ref 持有最新 fetcher，effect 不依赖它（避免 fetcher 引用变化触发重拉）
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  // 记录是否已完成首次加载
  const isFirstLoad = useRef(true)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    // 仅首次加载时显示 loading；后续依赖变化静默后台重拉（保留旧数据，不闪烁）
    if (isFirstLoad.current) {
      setLoading(true)
    }
    fetcherRef.current()
      .then((result) => {
        if (!cancelled) {
          setData(result)
          setError(null)
          isFirstLoad.current = false
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  return { data, loading, error, refresh }
}
