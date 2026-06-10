// 会话管理共享展示工具 —— Sessions.tsx 与 SessionDetailDialog 都从此 import，DRY。
import { MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SessionMessageDto } from '@shared/api-types';

// ──────────────────────────────────────────────
// 工具色调配置
// ──────────────────────────────────────────────
export const TOOL_CONFIG: Record<string, { color: string; label: string; dotColor: string }> = {
  claude: {
    color: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
    label: 'Claude Code',
    dotColor: 'bg-orange-500',
  },
  codex: {
    color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    label: 'Codex',
    dotColor: 'bg-blue-500',
  },
  gemini: {
    color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    label: 'Gemini CLI',
    dotColor: 'bg-emerald-500',
  },
};

export function toolLabel(tool: string): string {
  return TOOL_CONFIG[tool]?.label ?? tool;
}

// ──────────────────────────────────────────────
// 时间格式化
// ──────────────────────────────────────────────
export function formatTime(val?: string | number | null): string {
  if (val == null) return '';
  const d = typeof val === 'number' ? new Date(val) : new Date(val);
  if (Number.isNaN(d.getTime())) return '';
  const now = Date.now();
  const diff = now - d.getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 2) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

// ──────────────────────────────────────────────
// 目录缩短显示
// ──────────────────────────────────────────────
export function shortDir(dir?: string | null): string {
  if (!dir) return '';
  const parts = dir.replace(/\\/g, '/').split('/');
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : dir;
}

// ──────────────────────────────────────────────
// 骨架屏
// ──────────────────────────────────────────────
export function SessionListSkeleton() {
  // 动态 import Skeleton 会有 chunk 问题，直接内联动画占位。
  return (
    <div className="flex flex-col gap-px px-2 py-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 rounded-[8px] px-3 py-3">
          <div className="size-7 shrink-0 animate-pulse rounded-[7px] bg-muted" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3.5 w-4/5 animate-pulse rounded bg-muted" />
            <div className="h-3 w-3/5 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────
// 空态
// ──────────────────────────────────────────────
export function EmptyState({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: typeof MessageSquare;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" strokeWidth={1.85} />
      </div>
      <div className="space-y-1 text-center">
        <p className="text-[13px] font-medium text-foreground">{title}</p>
        <p className="text-[11.5px] text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// 消息角色徽章
// ──────────────────────────────────────────────
export const ROLE_STYLE: Record<string, string> = {
  user: 'bg-primary/10 text-primary',
  assistant: 'bg-muted text-muted-foreground',
  tool: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  system: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400',
};

export function RoleBadge({ role, label }: { role: string; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[10.5px] font-semibold',
        ROLE_STYLE[role] ?? ROLE_STYLE['system'],
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          role === 'user'
            ? 'bg-primary'
            : role === 'assistant'
              ? 'bg-muted-foreground/50'
              : role === 'tool'
                ? 'bg-amber-500'
                : 'bg-zinc-400',
        )}
        aria-hidden
      />
      {label}
    </span>
  );
}

// ──────────────────────────────────────────────
// 消息气泡
// ──────────────────────────────────────────────
export const BUBBLE_STYLE: Record<string, string> = {
  user: 'bg-primary/10 border-primary/20',
  assistant: 'bg-card border-border/60',
  tool: 'bg-muted/50 border-border/40',
  system: 'bg-muted/30 border-border/30',
};

export function MessageBubble({
  msg,
  roleLabel,
}: {
  msg: SessionMessageDto;
  roleLabel: string;
}) {
  const isToolCall = msg.role === 'tool' || msg.content?.startsWith('[Tool:');
  return (
    <div
      className={cn(
        'rounded-[10px] border px-3.5 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]',
        BUBBLE_STYLE[msg.role] ?? BUBBLE_STYLE['system'],
      )}
    >
      <div className="mb-1.5">
        <RoleBadge role={msg.role} label={roleLabel} />
      </div>
      <div
        className={cn(
          'whitespace-pre-wrap break-words text-[12.5px] leading-relaxed',
          isToolCall ? 'font-mono text-muted-foreground' : 'text-foreground',
        )}
      >
        {msg.content}
      </div>
    </div>
  );
}
