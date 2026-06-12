import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { bridge } from '@/services/bridge'

const KNOWN: Record<string, string> = {
  openai: 'OpenAI',
  custom: 'Custom',
}

/**
 * 会话供应商标签。nameMap 优先（hxg_<档id> → 接入档名），让号小管注入的供应商显示真名
 * （如「测试第三方」）而非泛称「号小管接入」。匹配不到再回落泛称/原值。
 */
export function providerLabel(provider: string, nameMap?: Record<string, string>): string {
  if (nameMap && nameMap[provider]) return nameMap[provider]
  if (KNOWN[provider]) return KNOWN[provider]
  if (provider.startsWith('hxg_')) return '号小管接入'
  return provider
}

export function ProviderTag({
  provider,
  nameMap,
  className,
}: {
  provider?: string
  nameMap?: Record<string, string>
  className?: string
}) {
  if (!provider) return null
  return (
    <span className={cn('shrink-0 rounded-[5px] bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground', className)}>
      {providerLabel(provider, nameMap)}
    </span>
  )
}

// Codex 接入档在 threads.model_provider 里的 id：必须与主进程 codexProviderId 同构
// （src/main/contexts/clientConfig/infrastructure/codex-toml.ts）。两处改一处必须同步另一处。
function hxgProviderId(profileId: string): string {
  return `hxg_${profileId.replace(/[^a-zA-Z0-9]/g, '')}`
}

/** 拉 codex 接入档建「hxg_<档id> → 接入档名」映射。供会话列表/修复弹窗/详情显示供应商真名。 */
export function useCodexProviderNames(): Record<string, string> {
  const [map, setMap] = useState<Record<string, string>>({})
  useEffect(() => {
    let alive = true
    bridge()
      .clientConfig.list('codex')
      .then((profiles) => {
        if (!alive) return
        const m: Record<string, string> = {}
        for (const p of profiles) m[hxgProviderId(p.id)] = p.name
        setMap(m)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return map
}
