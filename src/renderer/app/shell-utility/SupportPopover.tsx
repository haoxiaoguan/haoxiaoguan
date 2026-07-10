import { useTranslation } from 'react-i18next';
import qunQr from '@/assets/brand/qun.png';
import dashangQr from '@/assets/brand/dashang.png';

/** 支持图标的 hover 浮层：拆两块——左「QQ 群」二维码(qun.png) / 右「打赏作者」二维码(dashang.png)。 */
export function SupportPopover() {
  const { t } = useTranslation();

  const blocks = [
    { key: 'qq', label: t('nav:shell.support_panel.qq'), src: qunQr },
    { key: 'reward', label: t('nav:shell.support_panel.reward'), src: dashangQr },
  ];

  return (
    <div>
      <p className="text-sm font-semibold">{t('nav:shell.support_panel.title')}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t('nav:shell.support_panel.desc')}</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {blocks.map((b) => (
          <div key={b.key} className="flex flex-col items-center gap-1.5">
            <img
              src={b.src}
              alt={b.label}
              className="aspect-square w-full max-w-[120px] rounded border border-border/50 bg-white object-contain"
            />
            <span className="text-xs text-muted-foreground">{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
