// Claude 分级模型映射字段(快速/Haiku、Sonnet、Opus),落进 settings.modelMap。仅 Claude 客户端展示。
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';

export interface ModelMap {
  haiku: string;
  sonnet: string;
  opus: string;
}

export const EMPTY_MODEL_MAP: ModelMap = { haiku: '', sonnet: '', opus: '' };

export function ClaudeModelMapFields({
  value,
  onChange,
}: {
  value: ModelMap;
  onChange: (patch: Partial<ModelMap>) => void;
}) {
  const { t } = useTranslation('nav');
  const tiers: Array<keyof ModelMap> = ['haiku', 'sonnet', 'opus'];
  return (
    <div className="rounded-[8px] border border-border/60 px-3 py-2.5">
      <div className="text-[12px] font-medium text-foreground">{t('clientConfigPage.form.modelMapTitle')}</div>
      <p className="mb-2 mt-0.5 text-[11px] text-muted-foreground/70">{t('clientConfigPage.form.modelMapHint')}</p>
      <div className="grid grid-cols-3 gap-2">
        {tiers.map((tier) => (
          <label key={tier} className="text-[11px] font-medium text-muted-foreground">
            {t(`clientConfigPage.form.model_${tier}`)}
            <Input
              className="mt-1 font-mono text-[11px]"
              value={value[tier]}
              onChange={(e) => onChange({ [tier]: e.target.value })}
              placeholder="—"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
