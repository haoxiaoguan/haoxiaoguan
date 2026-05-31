import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface NotifyItem {
  title: string;
  time: string;
  unread: boolean;
}

/** 通知图标的 hover 浮层：通知中心列表（前端静态数据）。 */
export function NotificationPopover() {
  const { t } = useTranslation();
  const items = (t('nav:shell.notify.items', { returnObjects: true }) as NotifyItem[]) ?? [];

  return (
    <div>
      <div className="flex items-center justify-between border-b border-border/60 pb-2">
        <span className="border-b-2 border-primary pb-2 text-sm font-semibold">
          {t('nav:shell.notify.title')}
        </span>
        <button
          type="button"
          className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
        >
          {t('nav:shell.notify.more')}
        </button>
      </div>

      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t('nav:shell.notify.empty')}
        </p>
      ) : (
        <ul className="mt-1">
          {items.map((n, i) => (
            <li
              key={i}
              className="flex items-start gap-2 border-b border-border/40 py-2.5 last:border-b-0"
            >
              <span
                className={cn(
                  'mt-1.5 size-1.5 shrink-0 rounded-full',
                  n.unread ? 'bg-primary' : 'bg-transparent',
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-foreground/90">{n.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{n.time}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
