// Claude 分级模型映射:每档(快速/Haiku、Sonnet、Opus)= 显示名(/model 菜单名,写 *_MODEL_NAME)
// + 实际请求模型(写 *_MODEL,可下拉选)+ 1M 声明(给模型名加 [1M] 后缀,Claude Code 直接认)。
// 落进 settings.modelMap.{tier} = { model, name }。
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ModelCombobox } from './ModelCombobox';

export interface ModelTier {
  model: string;
  name: string;
}
export type ModelMap = { haiku: ModelTier; sonnet: ModelTier; opus: ModelTier };

export const EMPTY_MODEL_MAP: ModelMap = {
  haiku: { model: '', name: '' },
  sonnet: { model: '', name: '' },
  opus: { model: '', name: '' },
};

const ONE_M = '[1M]';

/** 拆出基础模型名与 1M 标记(大小写不敏感)。 */
export function splitOneM(raw: string): { base: string; oneM: boolean } {
  const t = raw.trimEnd();
  if (t.toLowerCase().endsWith('[1m]')) return { base: t.slice(0, -ONE_M.length).trimEnd(), oneM: true };
  return { base: raw, oneM: false };
}
/** 组合基础模型名 + 1M 后缀;base 为空则整体为空。 */
export function composeOneM(base: string, oneM: boolean): string {
  const b = base.trim();
  return b.length === 0 ? '' : oneM ? `${b}${ONE_M}` : b;
}

// Sonnet 在前,与 cc-switch 一致(最常用档置顶)。
const TIERS: Array<keyof ModelMap> = ['sonnet', 'opus', 'haiku'];

export function ClaudeModelMapFields({
  value,
  onTierChange,
  options,
}: {
  value: ModelMap;
  onTierChange: (tier: keyof ModelMap, patch: Partial<ModelTier>) => void;
  /** 「获取模型列表」拉到的可选模型,供下拉。 */
  options: string[];
}) {
  const { t } = useTranslation('nav');
  return (
    <div className="rounded-[8px] border border-border/60 px-3 py-3">
      <div className="text-[12px] font-medium text-foreground">{t('clientConfigPage.form.modelMapTitle')}</div>
      <p className="mb-2.5 mt-0.5 text-[11px] text-muted-foreground/70">{t('clientConfigPage.form.modelMapHint')}</p>
      <div className="grid grid-cols-[52px_1fr_1.3fr_auto] items-center gap-x-2.5 gap-y-2">
        {/* 表头 */}
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">{t('clientConfigPage.form.modelRole')}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">{t('clientConfigPage.form.modelDisplayName')}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">{t('clientConfigPage.form.modelActual')}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">1M</span>
        {TIERS.map((tier) => {
          const { base, oneM } = splitOneM(value[tier].model);
          return (
            <div key={tier} className="contents">
              <span className="text-[12px] font-medium text-muted-foreground">{t(`clientConfigPage.form.model_${tier}`)}</span>
              <Input
                className="text-[12px]"
                value={value[tier].name}
                onChange={(e) => onTierChange(tier, { name: e.target.value })}
                placeholder={t('clientConfigPage.form.modelDisplayNamePlaceholder')}
              />
              <ModelCombobox
                value={base}
                options={options}
                placeholder="—"
                onChange={(v) => onTierChange(tier, { model: composeOneM(v, oneM) })}
              />
              <Checkbox
                className="justify-self-center"
                checked={oneM}
                onCheckedChange={(c) => onTierChange(tier, { model: composeOneM(base, c === true) })}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
