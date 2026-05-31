import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  FolderInput,
  Globe,
  Pencil,
  Plus,
  RadioTower,
  Server,
  Terminal,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ManagementActionButton,
  ManagementInfoPill,
  ManagementPaginationBar,
  ManagementSearchField,
} from '@/components/management/ManagementControls';
import { cn } from '@/lib/utils';
import { useMcp } from '../../hooks/useMcp';
import { useMcpStore } from '../../stores/mcpStore';
import type { McpServer, McpTransport } from '../../types';
import { AgentLogo, SKILL_AGENTS, type SkillAgentId } from '../skills/AgentLogo';
import { McpFormModal } from './McpFormModal';
import { McpImportDialog } from './McpImportDialog';

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [20, 50, 100];

const TRANSPORT_META: Record<
  McpTransport,
  { label: string; tone: 'blue' | 'green' | 'purple'; icon: typeof Terminal }
> = {
  stdio: { label: 'stdio', tone: 'blue', icon: Terminal },
  http: { label: 'HTTP', tone: 'green', icon: Globe },
  sse: { label: 'SSE', tone: 'purple', icon: RadioTower },
};

export function McpServersList() {
  const { t } = useTranslation();
  const { servers, loading, error, refetch } = useMcp();
  const { deleteServer, toggleApp } = useMcpStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [showForm, setShowForm] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServer | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [syncingKey, setSyncingKey] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const agentCounts = useMemo(
    () =>
      SKILL_AGENTS.map((agent) => ({
        ...agent,
        count: servers.filter((server) => Boolean(server.apps[agent.id])).length,
      })),
    [servers],
  );

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredServers = useMemo(() => {
    if (!normalizedSearch) return servers;
    return servers.filter((server) => getServerSearchText(server).includes(normalizedSearch));
  }, [servers, normalizedSearch]);

  const totalPages = Math.max(1, Math.ceil(filteredServers.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const visibleServers = filteredServers.slice(
    (safeCurrentPage - 1) * pageSize,
    safeCurrentPage * pageSize,
  );

  const handleAdd = () => {
    setEditingServer(null);
    setShowForm(true);
  };

  const handleEdit = (server: McpServer) => {
    setEditingServer(server);
    setShowForm(true);
  };

  const handleFormClose = () => {
    setShowForm(false);
    setEditingServer(null);
    void refetch();
  };

  const handleToggleAgent = async (server: McpServer, agentId: SkillAgentId) => {
    const enabled = Boolean(server.apps[agentId]);
    const key = `${server.id}:${agentId}`;
    setActionError(null);
    setSyncingKey(key);
    try {
      await toggleApp(server.id, agentId, !enabled);
    } catch (e) {
      setActionError(String(e));
    } finally {
      setSyncingKey(null);
    }
  };

  const handleDelete = async (server: McpServer) => {
    setActionError(null);
    setDeletingId(server.id);
    try {
      await deleteServer(server.id);
    } catch (e) {
      setActionError(String(e));
    } finally {
      setDeletingId(null);
    }
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  };

  const handlePageSizeChange = (value: number) => {
    setPageSize(value);
    setCurrentPage(1);
  };

  if (loading) {
    return <McpServersSkeleton />;
  }

  if (error) {
    return <div className="text-sm text-destructive">{error}</div>;
  }

  return (
    <TooltipProvider delayDuration={120}>
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        <div className="flex shrink-0 flex-col gap-3 px-1 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            {agentCounts.map((agent) => (
              <ManagementInfoPill
                key={agent.id}
                tone={agent.tone}
                className="h-9 rounded-[10px] px-3 text-[13px]"
                iconNode={
                  <AgentLogo
                    agentId={agent.id}
                    className="size-5 rounded-[5px] border-0 bg-transparent shadow-none"
                    imageClassName="size-4"
                  />
                }
                label={`${agent.label}: ${agent.count}`}
              />
            ))}
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <ManagementSearchField
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder={t('mcp.search.placeholder', '搜索服务 / 描述 / 命令')}
              className="max-w-[420px]"
            />

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <ManagementActionButton icon={FolderInput} onClick={() => setImportOpen(true)}>
                {t('mcp.import.button', '导入已有')}
              </ManagementActionButton>
              <ManagementActionButton
                icon={Plus}
                onClick={handleAdd}
                className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
              >
                {t('mcp.addServer', '添加服务')}
              </ManagementActionButton>
            </div>
          </div>

          {actionError ? <div className="text-sm text-destructive">{actionError}</div> : null}
        </div>

        <div className="h-px shrink-0 bg-border" aria-hidden />

        <ScrollArea data-testid="mcp-list-shell" className="min-h-0 min-w-0 flex-1">
          {visibleServers.length > 0 ? (
            <div className="flex flex-col gap-1.5 p-1">
              {visibleServers.map((server) => (
                <McpServerRow
                  key={server.id}
                  server={server}
                  syncingKey={syncingKey}
                  deletingId={deletingId}
                  onEdit={handleEdit}
                  onToggleAgent={handleToggleAgent}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          ) : (
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 px-6 py-10 text-center">
              <p className="text-sm font-medium text-foreground">
                {servers.length === 0
                  ? t('mcp.empty', '暂无 MCP 服务')
                  : t('mcp.search.empty', '没有找到匹配的服务')}
              </p>
              <p className="text-xs text-muted-foreground">
                {servers.length === 0
                  ? t('mcp.emptyHint', '点击添加服务，或从各 Agent 配置导入已有服务。')
                  : t('mcp.search.emptyHint', '换个关键词再试试。')}
              </p>
              {servers.length === 0 ? (
                <ManagementActionButton icon={Plus} onClick={handleAdd}>
                  {t('mcp.addServer', '添加服务')}
                </ManagementActionButton>
              ) : null}
            </div>
          )}
        </ScrollArea>

        {visibleServers.length > 0 ? (
          <div className="shrink-0">
            <ManagementPaginationBar
              testId="mcp-pagination-row"
              total={filteredServers.length}
              currentPage={safeCurrentPage}
              pageSize={pageSize}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              onPageChange={setCurrentPage}
              onPageSizeChange={handlePageSizeChange}
            />
          </div>
        ) : null}
      </div>

      {showForm ? (
        <McpFormModal
          server={editingServer}
          existingIds={servers.map((s) => s.id)}
          onClose={handleFormClose}
        />
      ) : null}
      <McpImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => {
          void refetch();
        }}
      />
    </TooltipProvider>
  );
}

function McpServerRow({
  server,
  syncingKey,
  deletingId,
  onEdit,
  onToggleAgent,
  onDelete,
}: {
  server: McpServer;
  syncingKey: string | null;
  deletingId: string | null;
  onEdit: (server: McpServer) => void;
  onToggleAgent: (server: McpServer, agentId: SkillAgentId) => void;
  onDelete: (server: McpServer) => void;
}) {
  return (
    <div
      className={cn(
        'grid min-h-[92px] grid-cols-1 gap-3 px-4 py-3 transition-colors md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center md:gap-4',
        'rounded-[10px] border border-border bg-card hover:bg-muted/40',
      )}
    >
      <button
        type="button"
        onClick={() => onEdit(server)}
        className="flex min-w-0 items-start gap-3 text-left"
      >
        <McpGlyph transport={server.spec.transport} />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-[14px] font-semibold leading-5 text-foreground">
              {server.name}
            </span>
            <TransportBadge transport={server.spec.transport} />
            {server.tags.slice(0, 2).map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className="h-5 rounded-[6px] px-1.5 text-[11px] font-medium"
              >
                {tag}
              </Badge>
            ))}
          </div>
          <McpEndpoint server={server} />
          {server.description ? (
            <p className="line-clamp-1 text-[12.5px] leading-5 text-muted-foreground">
              {server.description}
            </p>
          ) : null}
        </div>
      </button>

      <div className="flex items-center gap-1.5 md:justify-end">
        {SKILL_AGENTS.map((agent) => (
          <AgentSyncButton
            key={agent.id}
            server={server}
            agentId={agent.id}
            agentLabel={agent.label}
            disabled={syncingKey === `${server.id}:${agent.id}`}
            onToggle={() => onToggleAgent(server, agent.id)}
          />
        ))}
      </div>

      <div className="flex items-center gap-0.5 justify-self-start md:justify-self-end">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`编辑 ${server.name}`}
              className="text-muted-foreground hover:text-foreground"
              onClick={() => onEdit(server)}
            >
              <Pencil aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>编辑</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`删除 ${server.name}`}
              disabled={deletingId === server.id}
              className="text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(server)}
            >
              <Trash2 aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>删除</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function McpEndpoint({ server }: { server: McpServer }) {
  const { spec } = server;
  const text =
    spec.transport === 'stdio'
      ? [spec.command, ...(spec.args ?? [])].filter(Boolean).join(' ')
      : (spec.url ?? '');

  if (!text) {
    return <span className="text-[12px] text-muted-foreground">未配置端点</span>;
  }

  return (
    <span className="truncate rounded-[6px] bg-muted px-1.5 py-0.5 font-mono text-[11.5px] text-muted-foreground">
      {text}
    </span>
  );
}

function TransportBadge({ transport }: { transport: McpTransport }) {
  const meta = TRANSPORT_META[transport] ?? TRANSPORT_META.stdio;
  const toneClass =
    meta.tone === 'green'
      ? 'border-emerald-500/30 text-emerald-600'
      : meta.tone === 'purple'
        ? 'border-violet-500/30 text-violet-600'
        : 'border-primary/30 text-primary';

  return (
    <Badge
      variant="outline"
      className={cn('h-5 rounded-[6px] px-1.5 text-[11px] font-medium', toneClass)}
    >
      {meta.label}
    </Badge>
  );
}

function AgentSyncButton({
  server,
  agentId,
  agentLabel,
  disabled,
  onToggle,
}: {
  server: McpServer;
  agentId: SkillAgentId;
  agentLabel: string;
  disabled: boolean;
  onToggle: () => void;
}) {
  const enabled = Boolean(server.apps[agentId]);
  const ariaLabel = enabled
    ? `取消同步 ${server.name} 到 ${agentLabel}`
    : `同步 ${server.name} 到 ${agentLabel}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          aria-pressed={enabled}
          disabled={disabled}
          className={cn(
            'relative inline-flex size-9 shrink-0 items-center justify-center rounded-[8px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
            enabled
              ? 'bg-primary/10 ring-1 ring-primary/25'
              : 'bg-muted/35 opacity-50 grayscale hover:bg-muted hover:opacity-100 hover:grayscale-0',
          )}
          onClick={onToggle}
        >
          <AgentLogo
            agentId={agentId}
            className="size-7 rounded-[7px] border-0 bg-transparent shadow-none"
            imageClassName="size-5"
          />
          {enabled ? (
            <span className="absolute -bottom-0.5 -right-0.5 inline-flex size-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-card">
              <Check className="size-2.5" aria-hidden />
            </span>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {enabled ? `${agentLabel} 已同步` : `同步到 ${agentLabel}`}
      </TooltipContent>
    </Tooltip>
  );
}

function McpGlyph({ transport }: { transport: McpTransport }) {
  const Icon = TRANSPORT_META[transport]?.icon ?? Server;

  return (
    <div className="inline-flex size-11 shrink-0 items-center justify-center rounded-[8px] border border-border bg-background text-primary shadow-sm">
      <Icon className="size-5" strokeWidth={1.85} aria-hidden />
    </div>
  );
}

function McpServersSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {SKILL_AGENTS.map((agent) => (
          <Skeleton key={agent.id} className="h-9 w-24 rounded-[10px]" />
        ))}
      </div>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-9 w-[360px] rounded-[8px]" />
        <Skeleton className="h-9 w-[240px] rounded-[8px]" />
      </div>
      <Skeleton className="h-[300px] rounded-[8px]" />
    </div>
  );
}

function getServerSearchText(server: McpServer) {
  return [
    server.name,
    server.description,
    server.spec.command,
    server.spec.url,
    ...(server.spec.args ?? []),
    ...server.tags,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}
