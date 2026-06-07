// Claude 分级模型映射(快速/Haiku、Sonnet、Opus),落进 settings.modelMap。仅 Claude 客户端展示。
// 每档:模型输入(可从「获取模型列表」拉到的 datalist 下拉选)+ 1M 勾选(给模型名加 [1m] 后缀,Claude Code 直接认)。
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';

export interface ModelMap {
  haiku: string;
  sonnet: string;
  opus: string;
}

export const EMPTY_MODEL_MAP: ModelMap = { haiku: '', sonnet: '', opus: '' };

const ONE_M = '[1m]';

/** 拆出基础模型名与 1M 标记。 */
function split(raw: string): { base: string; oneM: boolean } {
  return raw.endsWith(ONE_M) ? { base: raw.slice(0, -ONE_M.length), oneM: true } : { base: raw, oneM: false };
}
/** 组合基础模型名 + 1M 后缀;base 为空则整体为空。 */
function compose(base: string, oneM: boolean): string {
  const b = base.trim();
  return b.length === 0 ? '' : oneM ? b + ONE_M : b;
}

export function ClaudeModelMapFields({
  value,
  onChange,
  datalistId,
}: {
  value: ModelMap;
  onChange: (patch: Partial<ModelMap>) => void;
  /** 共享模型 datalist 的 id(由父级渲染,内含「获取模型列表」拉到的模型)。 */
  datalistId: string;
}) {
  const { t } = useTranslation('nav');
  const tiers: Array<keyof ModelMap> = ['haiku', 'sonnet', 'opus'];
  return (
    <div className="rounded-[8px] border border-border/60 px-3 py-2.5">
      <div className="text-[12px] font-medium text-foreground">{t('clientConfigPage.form.modelMapTitle')}</div>
      <p className="mb-2 mt-0.5 text-[11px] text-muted-foreground/70">{t('clientConfigPage.form.modelMapHint')}</p>
      <div className="grid grid-cols-3 gap-2">
        {tiers.map((tier) => {
          const { base, oneM } = split(value[tier]);
          return (
            <div key={tier} className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">{t(`clientConfigPage.form.model_${tier}`)}</span>
              <Input
                list={datalistId}
                className="font-mono text-[11px]"
                value={base}
                onChange={(e) => onChange({ [tier]: compose(e.target.value, oneM) })}
                placeholder="—"
              />
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground/80">
                <Checkbox
                  className="size-3.5"
                  checked={oneM}
                  onCheckedChange={(c) => onChange({ [tier]: compose(base, c === true) })}
                />
                {t('clientConfigPage.form.declare1m')}
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}
