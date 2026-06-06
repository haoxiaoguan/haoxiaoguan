// 客户端官方 logo（复用 @lobehub/icons-static-svg 静态 SVG，与 skills/AgentLogo 同源）。
// 6 个 CLI 客户端 → 各自官方品牌图标；vite 把 .svg import 解析为资源 URL 供 <img> 使用。
import claudeCodeIcon from '@lobehub/icons-static-svg/icons/claudecode-color.svg';
import codexIcon from '@lobehub/icons-static-svg/icons/codex-color.svg';
import geminiCliIcon from '@lobehub/icons-static-svg/icons/geminicli-color.svg';
import openCodeIcon from '@lobehub/icons-static-svg/icons/opencode.svg';
import openClawIcon from '@lobehub/icons-static-svg/icons/openclaw-color.svg';
import hermesIcon from '@lobehub/icons-static-svg/icons/hermesagent.svg';
import { cn } from '@/lib/utils';
import type { ClientConfigClientId } from '@shared/api-types';

const CLIENT_ICON_MAP: Record<ClientConfigClientId, string> = {
  claude: claudeCodeIcon,
  codex: codexIcon,
  gemini_cli: geminiCliIcon,
  opencode: openCodeIcon,
  openclaw: openClawIcon,
  hermes: hermesIcon,
};

export function ClientLogo({
  clientId,
  className,
  imageClassName,
}: {
  clientId: ClientConfigClientId;
  className?: string;
  imageClassName?: string;
}) {
  const src = CLIENT_ICON_MAP[clientId];
  return (
    <span
      className={cn(
        // 白底:保证官方 logo（含黑色单色款 opencode/hermes）在深浅主题下都清晰。
        'inline-flex size-7 shrink-0 items-center justify-center rounded-[7px] border border-border/60 bg-white shadow-sm',
        className,
      )}
      aria-hidden
    >
      <img src={src} alt="" className={cn('size-4', imageClassName)} draggable={false} />
    </span>
  );
}
