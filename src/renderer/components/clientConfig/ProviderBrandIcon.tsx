// 供应商品牌图标:有已登记的品牌图标则渲染官方 SVG,否则渲染首字母头像(底色 iconColor)。
// vite 把 .svg import 解析为资源 URL;图标必须静态 import,故在 BRAND_ICON_MAP 逐个登记。
// 与 brand-presets.ts 的 BrandPreset.icon 文件名保持一致。
import deepseekColor from '@lobehub/icons-static-svg/icons/deepseek-color.svg';
import chatglmColor from '@lobehub/icons-static-svg/icons/chatglm-color.svg';
import kimiColor from '@lobehub/icons-static-svg/icons/kimi-color.svg';
import qwenColor from '@lobehub/icons-static-svg/icons/qwen-color.svg';
import minimaxColor from '@lobehub/icons-static-svg/icons/minimax-color.svg';
import siliconcloudColor from '@lobehub/icons-static-svg/icons/siliconcloud-color.svg';
import openrouterIcon from '@lobehub/icons-static-svg/icons/openrouter.svg';
import stepfunColor from '@lobehub/icons-static-svg/icons/stepfun-color.svg';
import modelscopeColor from '@lobehub/icons-static-svg/icons/modelscope-color.svg';
import doubaoColor from '@lobehub/icons-static-svg/icons/doubao-color.svg';
import longcatColor from '@lobehub/icons-static-svg/icons/longcat-color.svg';
import wenxinColor from '@lobehub/icons-static-svg/icons/wenxin-color.svg';
import hunyuanColor from '@lobehub/icons-static-svg/icons/hunyuan-color.svg';
import yiColor from '@lobehub/icons-static-svg/icons/yi-color.svg';
import grokIcon from '@lobehub/icons-static-svg/icons/grok.svg';
import mistralColor from '@lobehub/icons-static-svg/icons/mistral-color.svg';
import groqIcon from '@lobehub/icons-static-svg/icons/groq.svg';
import sparkColor from '@lobehub/icons-static-svg/icons/spark-color.svg';
import togetherColor from '@lobehub/icons-static-svg/icons/together-color.svg';
import { cn } from '@/lib/utils';

/** 品牌图标文件名 → 资源 URL。键与 brand-presets.ts 的 icon 字段一致。 */
const BRAND_ICON_MAP: Record<string, string> = {
  'deepseek-color': deepseekColor,
  'chatglm-color': chatglmColor,
  'kimi-color': kimiColor,
  'qwen-color': qwenColor,
  'minimax-color': minimaxColor,
  'siliconcloud-color': siliconcloudColor,
  openrouter: openrouterIcon,
  'stepfun-color': stepfunColor,
  'modelscope-color': modelscopeColor,
  'doubao-color': doubaoColor,
  'longcat-color': longcatColor,
  'wenxin-color': wenxinColor,
  'hunyuan-color': hunyuanColor,
  'yi-color': yiColor,
  grok: grokIcon,
  'mistral-color': mistralColor,
  groq: groqIcon,
  'spark-color': sparkColor,
  'together-color': togetherColor,
};

function firstChar(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 1).toUpperCase() : '?';
}

export function ProviderBrandIcon({
  icon,
  iconColor,
  name,
  className,
  imageClassName,
}: {
  icon?: string;
  iconColor?: string;
  name: string;
  className?: string;
  imageClassName?: string;
}) {
  const src = icon ? BRAND_ICON_MAP[icon] : undefined;

  if (src) {
    return (
      <span
        className={cn(
          'inline-flex size-7 shrink-0 items-center justify-center rounded-[7px] border border-border/60 bg-white shadow-sm',
          className,
        )}
        aria-hidden
      >
        <img src={src} alt="" className={cn('size-4', imageClassName)} draggable={false} />
      </span>
    );
  }

  // 兜底:首字母头像。
  return (
    <span
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-[7px] text-[11px] font-semibold text-white shadow-sm',
        className,
      )}
      style={{ backgroundColor: iconColor ?? 'hsl(var(--muted-foreground))' }}
      aria-hidden
    >
      {firstChar(name)}
    </span>
  );
}
