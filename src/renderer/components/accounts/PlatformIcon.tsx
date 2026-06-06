// 账号管理平台官方图标（复用 @lobehub/icons-static-svg 静态 SVG，与 clientConfig/ClientLogo 同源）。
// 各 AI 工具用其官方品牌 logo;无官方图标的(如 zed)走 lucide 兜底。白底 chip 保证深浅主题都清晰。
import antigravityIcon from '@lobehub/icons-static-svg/icons/antigravity-color.svg';
import codebuddyIcon from '@lobehub/icons-static-svg/icons/codebuddy-color.svg';
import codexIcon from '@lobehub/icons-static-svg/icons/codex-color.svg';
import cursorIcon from '@lobehub/icons-static-svg/icons/cursor.svg';
import geminiCliIcon from '@lobehub/icons-static-svg/icons/geminicli-color.svg';
import githubCopilotIcon from '@lobehub/icons-static-svg/icons/githubcopilot.svg';
import kiroIcon from '@lobehub/icons-static-svg/icons/kiro-color.svg';
import qoderIcon from '@lobehub/icons-static-svg/icons/qoder-color.svg';
import traeIcon from '@lobehub/icons-static-svg/icons/trae-color.svg';
import windsurfIcon from '@lobehub/icons-static-svg/icons/windsurf.svg';
import { Gem } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PlatformId } from '../../types';

interface PlatformIconProps {
  platform: PlatformId;
  className?: string;
  iconClassName?: string;
}

// 平台 → 官方品牌 SVG。无官方图标的平台不在此表，走 lucide 兜底。
const PLATFORM_ICON_MAP: Partial<Record<PlatformId, string>> = {
  cursor: cursorIcon,
  windsurf: windsurfIcon,
  antigravity: antigravityIcon,
  kiro: kiroIcon,
  'github-copilot': githubCopilotIcon,
  codex: codexIcon,
  'gemini-cli': geminiCliIcon,
  codebuddy: codebuddyIcon,
  'codebuddy-cn': codebuddyIcon,
  qoder: qoderIcon,
  trae: traeIcon,
};

export function PlatformIcon({ platform, className, iconClassName }: PlatformIconProps) {
  const src = PLATFORM_ICON_MAP[platform];
  if (src !== undefined) {
    return (
      <span
        className={cn(
          'inline-flex size-9 shrink-0 items-center justify-center rounded-[8px] border border-border/60 bg-white shadow-sm',
          className,
        )}
        aria-hidden
      >
        <img src={src} alt="" className={cn('size-5', iconClassName)} draggable={false} />
      </span>
    );
  }

  // 兜底（如 zed:lobehub 暂无官方图标）。
  return (
    <span
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-zinc-950 text-violet-400 shadow-sm',
        className,
      )}
      aria-hidden
    >
      <Gem className={cn('size-5', iconClassName)} strokeWidth={2} />
    </span>
  );
}
