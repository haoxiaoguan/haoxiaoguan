import { cn } from '@/lib/utils'

const KNOWN: Record<string, string> = {
  openai: 'OpenAI',
  custom: 'Custom',
}

export function providerLabel(provider: string): string {
  if (KNOWN[provider]) return KNOWN[provider]
  if (provider.startsWith('hxg_')) return '号小管接入'
  return provider
}

export function ProviderTag({ provider, className }: { provider?: string; className?: string }) {
  if (!provider) return null
  return (
    <span className={cn('shrink-0 rounded-[5px] bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground', className)}>
      {providerLabel(provider)}
    </span>
  )
}
