import { useTranslation } from 'react-i18next';
import { Bot, Copy, FolderOpen, MessageSquare, Play, Trash2 } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { SessionSummaryDto, SessionMessageDto } from '@shared/api-types';
import { TOOL_CONFIG, toolLabel, MessageBubble, EmptyState } from './shared';
import { ProviderTag } from './ProviderTag';

export function SessionDetailDialog({
  session,
  messages,
  loading,
  roleLabel,
  open,
  onOpenChange,
  onResume,
  onCopy,
  onDelete,
}: {
  session: SessionSummaryDto | null;
  messages: SessionMessageDto[];
  loading: boolean;
  roleLabel: (role: string) => string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onResume: (s: SessionSummaryDto) => void;
  onCopy: (s: SessionSummaryDto) => void;
  onDelete: (s: SessionSummaryDto) => void;
}) {
  const { t } = useTranslation('nav');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* 定高(非 max-h):ScrollArea viewport 的 h-full 需要确定高度链才能触发滚动 */}
      <DialogContent className="flex h-[80vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        {session ? (
          <>
            {/* 详情头部 */}
            {/* pr-12 给 DialogContent 内置的关闭按钮(absolute right-4)留出空间 */}
            <div className="shrink-0 border-b border-border/80 py-3.5 pl-5 pr-12">
              <div className="flex min-w-0 items-start justify-between gap-3">
                {/* 标题 + 目录 */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-primary/10">
                      <Bot className="size-4 text-primary" strokeWidth={1.85} />
                    </div>
                    <h2 className="truncate text-[14px] font-semibold leading-6 text-foreground">
                      {session.title ?? session.sessionId}
                    </h2>
                    {/* 工具 badge:outline variant 避免 default 的 hover:bg-primary 盖掉工具配色 */}
                    <Badge
                      variant="outline"
                      className={cn(
                        'h-5 shrink-0 border-transparent px-1.5 text-[11px]',
                        TOOL_CONFIG[session.tool]?.color ?? 'bg-muted text-muted-foreground',
                      )}
                    >
                      {toolLabel(session.tool)}
                    </Badge>
                    {/* provider tag */}
                    <ProviderTag provider={session.provider} />
                  </div>

                  {/* 目录 chip */}
                  {session.projectDir && (
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="mt-1.5 ml-10 inline-flex items-center gap-1.5 rounded-[6px] bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            onClick={() =>
                              session.projectDir &&
                              void navigator.clipboard.writeText(session.projectDir)
                            }
                          >
                            <FolderOpen className="size-3 shrink-0" strokeWidth={1.8} />
                            <span className="max-w-[320px] truncate">{session.projectDir}</span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">{t('sessionsView.copyDir')}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>

                {/* 操作按钮组 */}
                <TooltipProvider delayDuration={200}>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {session.resumeCommand && (
                      <>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5 rounded-[8px] px-3 text-[12px]"
                              onClick={() => onResume(session)}
                            >
                              <Play className="size-3.5" strokeWidth={1.9} />
                              {t('sessionsView.resume')}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t('sessionsView.resume')}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 rounded-[8px] text-muted-foreground hover:text-foreground"
                              aria-label={t('sessionsView.copyCmd')}
                              onClick={() => onCopy(session)}
                            >
                              <Copy className="size-3.5" strokeWidth={1.9} />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t('sessionsView.copyCmd')}</TooltipContent>
                        </Tooltip>
                      </>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 rounded-[8px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          aria-label={t('sessionsView.delete')}
                          onClick={() => onDelete(session)}
                        >
                          <Trash2 className="size-3.5" strokeWidth={1.9} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('sessionsView.delete')}</TooltipContent>
                    </Tooltip>
                  </div>
                </TooltipProvider>
              </div>
            </div>

            {/* 消息时间线 */}
            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col gap-3 px-5 py-4">
                {messages.length === 0 && loading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-foreground" />
                  </div>
                ) : messages.length === 0 ? (
                  <EmptyState
                    icon={MessageSquare}
                    title={t('sessionsView.emptyDetail')}
                    subtitle={t('sessionsView.emptyDetailSub')}
                  />
                ) : (
                  messages.map((m, i) => (
                    <MessageBubble key={i} msg={m} roleLabel={roleLabel(m.role)} />
                  ))
                )}
              </div>
            </ScrollArea>
          </>
        ) : (
          /* 未选会话：弹窗内空态 */
          <div className="p-6">
            <EmptyState
              icon={MessageSquare}
              title={t('sessionsView.emptyDetail')}
              subtitle={t('sessionsView.emptyDetailSub')}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
