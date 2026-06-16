import { useRef, type ReactNode } from 'react'
import { useLocation, useOutlet } from 'react-router-dom'

interface KeepAliveOutletProps {
  /** 返回 true 的路径不缓存（每次重新挂载）。如 settings 这类自带嵌套 Outlet 的路由。 */
  exclude?: (pathname: string) => boolean
  /** 最多缓存的页面数；超出按「最早访问且非当前」淘汰。默认 16（覆盖全部主路由，基本不触发）。 */
  max?: number
}

interface Cached {
  key: string
  node: ReactNode
}

/**
 * 路由级 KeepAlive（类 Vue <keep-alive>）：缓存已访问页面的组件实例，
 * 切走时用 display:none 隐藏而非卸载 → 切回时本地状态、以及「内部滚动页」的滚动位置都保留。
 *
 * 用 useOutlet() 取当前匹配的子路由元素，按 pathname 缓存；活跃页 display:contents（不影响布局，
 * 等同直接子节点），其余 display:none。按 key 复用，React 凭 key 保留各页组件实例。
 * 纯 React 实现，不引第三方依赖、不 patch React 内部，React 19 原生兼容。
 */
export function KeepAliveOutlet({ exclude, max = 16 }: KeepAliveOutletProps) {
  const location = useLocation()
  const outlet = useOutlet()
  const key = location.pathname
  const excluded = exclude?.(key) ?? false

  const cacheRef = useRef<Cached[]>([])

  if (!excluded && outlet) {
    const existing = cacheRef.current.find((c) => c.key === key)
    if (existing) {
      // 活跃页：刷新为最新元素（同 key 复用实例，状态保留，路由上下文更新到最新）。
      existing.node = outlet
    } else {
      cacheRef.current.push({ key, node: outlet })
      // 超额淘汰：移除最早访问且非当前的页面（保证当前页与近用页常驻）。
      while (cacheRef.current.length > max) {
        const i = cacheRef.current.findIndex((c) => c.key !== key)
        if (i < 0) break
        cacheRef.current.splice(i, 1)
      }
    }
  }

  return (
    <>
      {/* 被排除的路由：不缓存，正常挂载/卸载。 */}
      {excluded ? outlet : null}
      {cacheRef.current.map(({ key: k, node }) => (
        <div
          key={k}
          data-keepalive={k}
          style={{ display: !excluded && k === key ? 'contents' : 'none' }}
        >
          {node}
        </div>
      ))}
    </>
  )
}
