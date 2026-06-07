// 品牌预设网格:首格「自定义」,其余为品牌(图标 + 名称),选中高亮。替换原先的下拉。
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ProviderBrandIcon } from './ProviderBrandIcon';
import { cn } from '@/lib/utils';
import type { ProviderPreset } from './provider-templates';

const CUSTOM = 'custom';

const CELL =
  'flex flex-col items-center gap-1.5 rounded-[8px] border px-2 py-2.5 text-center transition-colors';
const ACTIVE = 'border-primary bg-primary/[0.06]';
const IDLE = 'border-border/60 hover:bg-muted';

export function ProviderPresetGrid({
  presets,
  value,
  onPick,
}: {
  presets: ProviderPreset[];
  value: string;
  onPick: (id: string) => void;
}) {
  const { t } = useTranslation('nav');
  return (
    <div className="grid max-h-[220px] grid-cols-3 gap-2 overflow-y-auto pr-1">
      <button type="button" onClick={() => onPick(CUSTOM)} className={cn(CELL, value === CUSTOM ? ACTIVE : IDLE)}>
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-[7px] border border-border/60 bg-muted">
          <Plus className="size-3.5 text-muted-foreground" aria-hidden />
        </span>
        <span className="w-full truncate text-[11px] text-foreground">{t('clientConfigPage.form.custom')}</span>
      </button>
      {presets.map((p) => (
        <button key={p.id} type="button" onClick={() => onPick(p.id)} className={cn(CELL, value === p.id ? ACTIVE : IDLE)}>
          <ProviderBrandIcon icon={p.icon} iconColor={p.iconColor} name={p.label} />
          <span className="w-full truncate text-[11px] text-foreground">{p.label}</span>
        </button>
      ))}
    </div>
  );
}
