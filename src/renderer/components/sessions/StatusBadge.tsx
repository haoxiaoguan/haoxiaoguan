import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export function StatusBadge({ archived }: { archived?: boolean }) {
  const { t } = useTranslation('nav')
  if (archived) {
    return (
      <span className={cn(
        'inline-flex shrink-0 items-center rounded-[5px] border border-transparent px-1.5 py-0.5 text-[10px] font-semibold',
        'bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400',
      )}>
        {t('sessionsView.statusArchived')}
      </span>
    )
  }
  return (
    <span className={cn(
      'inline-flex shrink-0 items-center rounded-[5px] border border-transparent px-1.5 py-0.5 text-[10px] font-semibold',
      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
    )}>
      {t('sessionsView.statusNormal')}
    </span>
  )
}
