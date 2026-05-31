import { useTranslation } from 'react-i18next';
import { SampleQRCode } from '@/components/ui/sample-qrcode';

/** 支持图标的 hover 浮层：微信群 / QQ 群二维码（示例占位）。 */
export function SupportPopover() {
  const { t } = useTranslation();

  const groups = [
    { key: 'wechat', label: t('nav:shell.support_panel.wechat'), seed: 'haoxiaoguan-wechat' },
    { key: 'qq', label: t('nav:shell.support_panel.qq'), seed: 'haoxiaoguan-qq' },
  ];

  return (
    <div>
      <p className="text-sm font-semibold">{t('nav:shell.support_panel.title')}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t('nav:shell.support_panel.desc')}</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {groups.map((g) => (
          <div key={g.key} className="flex flex-col items-center gap-1.5">
            <SampleQRCode seed={g.seed} size={112} className="border border-border/50" />
            <span className="text-xs text-muted-foreground">{g.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
