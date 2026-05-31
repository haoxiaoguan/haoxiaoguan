import type { ComponentType } from 'react';
import { Bot, Code2, Gem, Github, Hexagon, Minus, Orbit, Waves } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PlatformId } from '../../types';

interface PlatformIconProps {
  platform: PlatformId;
  className?: string;
  iconClassName?: string;
}

export function PlatformIcon({ platform, className, iconClassName }: PlatformIconProps) {
  if (platform === 'cursor') {
    return (
      <span
        className={cn(
          'relative inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-black text-white shadow-sm',
          className,
        )}
        aria-hidden
      >
        <span className="absolute size-5 rotate-45 rounded-[2px] bg-white/95" />
        <span className="absolute size-3 rotate-45 rounded-[1px] bg-zinc-600" />
        <span className="absolute size-2 rotate-45 rounded-[1px] bg-zinc-100" />
      </span>
    );
  }

  if (platform === 'gemini-cli') {
    return (
      <span
        className={cn(
          'relative inline-flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-white',
          className,
        )}
        aria-hidden
      >
        <span className="absolute h-7 w-7 rotate-45 rounded-[3px] bg-[conic-gradient(from_20deg,#4285f4,#a142f4,#ea4335,#fbbc04,#34a853,#4285f4)]" />
        <span className="absolute size-3 rounded-full bg-white" />
      </span>
    );
  }

  const Icon = platformIconMap[platform]?.icon ?? Hexagon;
  const tone = platformIconMap[platform]?.tone ?? 'bg-zinc-900 text-white';

  return (
    <span
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-[8px] shadow-sm',
        tone,
        className,
      )}
      aria-hidden
    >
      <Icon className={cn('size-5', iconClassName)} strokeWidth={2} />
    </span>
  );
}

const platformIconMap: Partial<
  Record<PlatformId, { icon: ComponentType<{ className?: string; strokeWidth?: number }>; tone: string }>
> = {
  windsurf: { icon: Waves, tone: 'bg-zinc-950 text-emerald-300' },
  antigravity: { icon: Orbit, tone: 'bg-emerald-600 text-white' },
  kiro: { icon: Bot, tone: 'bg-indigo-600 text-white' },
  'github-copilot': { icon: Github, tone: 'bg-zinc-950 text-white' },
  codex: { icon: Code2, tone: 'bg-white text-zinc-950 ring-1 ring-border' },
  codebuddy: { icon: Bot, tone: 'bg-pink-500 text-white' },
  'codebuddy-cn': { icon: Bot, tone: 'bg-rose-500 text-white' },
  qoder: { icon: Hexagon, tone: 'bg-zinc-950 text-white' },
  trae: { icon: Minus, tone: 'bg-red-500 text-white' },
  zed: { icon: Gem, tone: 'bg-zinc-950 text-violet-400' },
};
