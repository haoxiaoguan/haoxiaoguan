import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface DataWallCardProps {
  children: ReactNode
  className?: string
  title?: string
  headerRight?: ReactNode
}

/**
 * Shared shell for data-wall display cards.
 * Handles the card chrome (rounded corners, border, shadow, padding)
 * and an optional small-title header row.
 */
export function DataWallCard({ children, className, title, headerRight }: DataWallCardProps) {
  return (
    <div
      className={cn(
        'rounded-[14px] border border-border bg-card text-card-foreground shadow-bento-light dark:shadow-bento',
        className,
      )}
    >
      {title != null && (
        <div className="flex items-center justify-between px-[13px] pt-[13px]">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {title}
          </span>
          {headerRight ?? null}
        </div>
      )}
      <div className="p-[13px]">{children}</div>
    </div>
  )
}
