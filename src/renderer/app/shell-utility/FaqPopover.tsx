import { useTranslation } from 'react-i18next';

/** 文档图标的 hover 浮层：常见问题列表（前端静态数据）。 */
export function FaqPopover() {
  const { t } = useTranslation();
  const items = (t('nav:shell.faq.items', { returnObjects: true }) as string[]) ?? [];

  return (
    <div>
      <div className="flex items-center justify-between border-b border-border/60 pb-2">
        <span className="border-b-2 border-primary pb-2 text-sm font-semibold">
          {t('nav:shell.faq.title')}
        </span>
        <button
          type="button"
          className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
        >
          {t('nav:shell.faq.more')}
        </button>
      </div>
      <ul className="mt-1">
        {items.map((q, i) => (
          <li key={i}>
            <button
              type="button"
              className="w-full border-b border-border/40 py-2.5 text-left text-[13px] text-foreground/85 transition-colors last:border-b-0 hover:text-primary"
            >
              {q}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
