/**
 * 平台主色调色板（12 个平台），用于 chip / accent bar / 进度条等。
 * 设计语言来自 Dashboard KpiCard 的 4 色 accent 系统，扩展到 12 平台。
 */

export interface PlatformTone {
  /** 3px 顶部/左侧 accent bar */
  bar: string;
  /** chip 底色 + 文字 */
  chip: string;
  /** 大块 glow 渐变（from-* 起色） */
  glow: string;
  /** 进度条填充色 */
  progress: string;
  /** detail 面板淡背景 */
  soft: string;
}

export const PLATFORM_TONE: Record<string, PlatformTone> = {
  cursor: {
    bar: 'bg-[#2563eb]',
    chip: 'bg-[#2563eb]/15 text-[#2563eb] dark:text-[#93c5fd]',
    glow: 'from-[#2563eb]/12 via-transparent to-transparent',
    progress: 'bg-[#2563eb]',
    soft: 'bg-[#2563eb]/5',
  },
  windsurf: {
    bar: 'bg-[#22c55e]',
    chip: 'bg-[#22c55e]/15 text-[#16a34a] dark:text-[#86efac]',
    glow: 'from-[#22c55e]/14 via-transparent to-transparent',
    progress: 'bg-[#22c55e]',
    soft: 'bg-[#22c55e]/5',
  },
  antigravity: {
    bar: 'bg-[#059669]',
    chip: 'bg-[#059669]/15 text-[#047857] dark:text-[#6ee7b7]',
    glow: 'from-[#059669]/14 via-transparent to-transparent',
    progress: 'bg-[#059669]',
    soft: 'bg-[#059669]/5',
  },
  kiro: {
    bar: 'bg-[#f59e0b]',
    chip: 'bg-[#f59e0b]/15 text-[#b45309] dark:text-[#fbbf24]',
    glow: 'from-[#f59e0b]/14 via-transparent to-transparent',
    progress: 'bg-[#f59e0b]',
    soft: 'bg-[#f59e0b]/5',
  },
  'github-copilot': {
    bar: 'bg-[#6366f1]',
    chip: 'bg-[#6366f1]/15 text-[#4f46e5] dark:text-[#a5b4fc]',
    glow: 'from-[#6366f1]/14 via-transparent to-transparent',
    progress: 'bg-[#6366f1]',
    soft: 'bg-[#6366f1]/5',
  },
  codex: {
    bar: 'bg-[#10b981]',
    chip: 'bg-[#10b981]/15 text-[#047857] dark:text-[#34d399]',
    glow: 'from-[#10b981]/14 via-transparent to-transparent',
    progress: 'bg-[#10b981]',
    soft: 'bg-[#10b981]/5',
  },
  'gemini-cli': {
    bar: 'bg-[#0ea5e9]',
    chip: 'bg-[#0ea5e9]/15 text-[#0369a1] dark:text-[#7dd3fc]',
    glow: 'from-[#0ea5e9]/14 via-transparent to-transparent',
    progress: 'bg-[#0ea5e9]',
    soft: 'bg-[#0ea5e9]/5',
  },
  codebuddy: {
    bar: 'bg-[#ec4899]',
    chip: 'bg-[#ec4899]/15 text-[#be185d] dark:text-[#f9a8d4]',
    glow: 'from-[#ec4899]/14 via-transparent to-transparent',
    progress: 'bg-[#ec4899]',
    soft: 'bg-[#ec4899]/5',
  },
  'codebuddy-cn': {
    bar: 'bg-[#f43f5e]',
    chip: 'bg-[#f43f5e]/15 text-[#be123c] dark:text-[#fda4af]',
    glow: 'from-[#f43f5e]/14 via-transparent to-transparent',
    progress: 'bg-[#f43f5e]',
    soft: 'bg-[#f43f5e]/5',
  },
  qoder: {
    bar: 'bg-[#8b5cf6]',
    chip: 'bg-[#8b5cf6]/15 text-[#6d28d9] dark:text-[#c4b5fd]',
    glow: 'from-[#8b5cf6]/14 via-transparent to-transparent',
    progress: 'bg-[#8b5cf6]',
    soft: 'bg-[#8b5cf6]/5',
  },
  trae: {
    bar: 'bg-[#14b8a6]',
    chip: 'bg-[#14b8a6]/15 text-[#0f766e] dark:text-[#5eead4]',
    glow: 'from-[#14b8a6]/14 via-transparent to-transparent',
    progress: 'bg-[#14b8a6]',
    soft: 'bg-[#14b8a6]/5',
  },
  zed: {
    bar: 'bg-[#a855f7]',
    chip: 'bg-[#a855f7]/15 text-[#7e22ce] dark:text-[#d8b4fe]',
    glow: 'from-[#a855f7]/14 via-transparent to-transparent',
    progress: 'bg-[#a855f7]',
    soft: 'bg-[#a855f7]/5',
  },
};

/** 从 platform 取首字母 chip 文字（fallback 用 platform 第一个字符）。 */
export function platformInitial(displayName: string | undefined, fallback: string): string {
  return (displayName || fallback).trim().charAt(0).toUpperCase();
}
