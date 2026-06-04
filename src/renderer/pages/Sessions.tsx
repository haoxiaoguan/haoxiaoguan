import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSessionsStore, TOOLS } from '../stores/sessionsStore';
import { SegmentedOptions } from '../components/ui/segmented-options';
import type { SessionSummaryDto } from '@shared/api-types';

export default function Sessions() {
  const { t } = useTranslation('nav');
  const {
    probes, activeTool, byTool, selectedId, messages, loading, error,
    init, selectTool, loadMore, selectSession, deleteSession, resume, deleteSelected,
  } = useSessionsStore();

  const [query, setQuery] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  const cur = byTool[activeTool];
  const items = cur?.items ?? [];
  const hasMore = cur ? cur.offset < cur.total : false;
  const selectedSession = items.find((i) => i.sessionId === selectedId);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((s) =>
      [s.title, s.summary, s.projectDir, s.sessionId].some((f) => f?.toLowerCase().includes(q)),
    );
  }, [items, query]);

  const toolItems = TOOLS.map((tool) => {
    const probe = probes.find((p) => p.tool === tool);
    const label = tool === 'claude' ? 'Claude Code' : tool === 'codex' ? 'Codex' : 'Gemini CLI';
    return { value: tool, label: probe?.hasSessions === false ? `${label} (0)` : label };
  });

  const copyResume = async (s: SessionSummaryDto) => {
    if (!s.resumeCommand) return;
    const cmd = s.projectDir ? `cd "${s.projectDir}" && ${s.resumeCommand}` : s.resumeCommand;
    try {
      await navigator.clipboard.writeText(cmd);
      toast.success(cmd);
    } catch {
      toast.error(cmd);
    }
  };

  const onResume = async (s: SessionSummaryDto) => {
    try {
      await resume(s);
      toast.success(t('sessions'));
    } catch {
      void copyResume(s); // 终端未配置/失败 → 降级为复制
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <SegmentedOptions
        items={toolItems}
        value={activeTool}
        onChange={(v) => void selectTool(v as typeof activeTool)}
      />
      <div className="flex min-h-0 flex-1 gap-3">
        {/* 左栏：列表 */}
        <div className="flex w-[340px] min-h-0 flex-col rounded-lg border">
          {/* 搜索框 + 批量管理 */}
          <div className="flex items-center gap-2 px-2 py-1 border-b">
            <input
              className="flex-1 rounded border px-2 py-1 text-sm bg-background"
              placeholder="搜索标题/目录/id"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              className="rounded border px-2 py-1 text-xs"
              onClick={() => { setSelectMode((v) => !v); setSelected(new Set()); }}
            >
              {selectMode ? '取消' : '批量'}
            </button>
            {selectMode && selected.size > 0 && (
              <button
                className="rounded border px-2 py-1 text-xs text-destructive"
                onClick={() => {
                  if (window.confirm(`删除选中的 ${selected.size} 个会话？不可恢复。`)) {
                    void deleteSelected(filtered.filter((s) => selected.has(s.sourcePath)));
                    setSelected(new Set());
                    setSelectMode(false);
                  }
                }}
              >
                删除所选 ({selected.size})
              </button>
            )}
          </div>
          <div className="flex-1 overflow-auto">
            {filtered.length === 0 && !loading ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {loading ? '…' : '—'}
              </div>
            ) : (
              filtered.map((s) => (
                <button
                  key={s.sourcePath}
                  onClick={() => {
                    if (!selectMode) void selectSession(s);
                  }}
                  className={`block w-full border-b px-3 py-2 text-left text-sm hover:bg-muted ${selectedId === s.sessionId ? 'bg-muted' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    {selectMode && (
                      <input
                        type="checkbox"
                        className="mr-1 shrink-0"
                        checked={selected.has(s.sourcePath)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(s.sourcePath);
                            else next.delete(s.sourcePath);
                            return next;
                          });
                        }}
                      />
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-medium">{s.title ?? s.sessionId}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {s.projectDir ?? ''} · {s.lastActiveAt ? new Date(s.lastActiveAt).toLocaleString() : ''}
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
          {hasMore && (
            <button
              className="border-t py-2 text-sm text-primary"
              onClick={() => void loadMore()}
              disabled={loading}
            >
              加载更多
            </button>
          )}
        </div>
        {/* 右栏：详情 */}
        <div className="flex min-h-0 flex-1 flex-col rounded-lg border">
          {selectedSession ? (
            <>
              <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{selectedSession.title ?? selectedSession.sessionId}</div>
                  <button
                    className="truncate text-xs text-muted-foreground hover:underline"
                    onClick={() =>
                      selectedSession.projectDir &&
                      void navigator.clipboard.writeText(selectedSession.projectDir)
                    }
                  >
                    {selectedSession.projectDir ?? ''}
                  </button>
                </div>
                <div className="flex shrink-0 gap-2">
                  {selectedSession.resumeCommand && (
                    <>
                      <button
                        className="rounded border px-2 py-1 text-xs"
                        onClick={() => void onResume(selectedSession)}
                      >
                        恢复
                      </button>
                      <button
                        className="rounded border px-2 py-1 text-xs"
                        onClick={() => void copyResume(selectedSession)}
                      >
                        复制命令
                      </button>
                    </>
                  )}
                  <button
                    className="rounded border px-2 py-1 text-xs text-destructive"
                    onClick={() => {
                      if (window.confirm('删除后不可恢复，确认删除该会话？'))
                        void deleteSession(selectedSession);
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
              <div className="flex-1 space-y-2 overflow-auto p-4">
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={`rounded-md px-3 py-2 text-sm ${
                      m.role === 'user'
                        ? 'bg-primary/10'
                        : m.role === 'tool'
                          ? 'bg-muted'
                          : 'bg-card'
                    }`}
                  >
                    <div className="mb-1 text-xs font-semibold text-muted-foreground">{m.role}</div>
                    <div className="whitespace-pre-wrap break-words">{m.content}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              —
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
