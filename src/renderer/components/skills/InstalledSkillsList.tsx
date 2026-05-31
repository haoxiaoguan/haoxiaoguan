import { useMemo, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Archive,
  BookOpen,
  Check,
  Code2,
  ExternalLink,
  FileImage,
  FileSpreadsheet,
  FolderInput,
  Globe2,
  History,
  Presentation,
  Puzzle,
  RefreshCw,
  Trash2,
  type LucideProps,
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
import { useSkills } from '../../hooks/useSkills';
import { skillsService } from '../../services/tauri';
import { useSkillsStore } from '../../stores/skillsStore';
import type { InstalledSkill } from '../../types';
import { AgentLogo, SKILL_AGENTS, type SkillAgentId } from './AgentLogo';
import { ImportUnmanagedDialog } from './ImportUnmanagedDialog';
import { BackupRestoreDialog } from './BackupRestoreDialog';

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [20, 50, 100];

export function InstalledSkillsList() {
  const { t } = useTranslation();
  const { installed, loading, error, refetch } = useSkills();
  const { uninstallSkill, toggleApp } = useSkillsStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updatingAll, setUpdatingAll] = useState(false);
  const [importingZip, setImportingZip] = useState(false);
  const [importUnmanagedOpen, setImportUnmanagedOpen] = useState(false);
  const [backupRestoreOpen, setBackupRestoreOpen] = useState(false);
  const [syncingKey, setSyncingKey] = useState<string | null>(null);
  const [deletingSkillId, setDeletingSkillId] = useState<string | null>(null);
  const [updateSkillIds, setUpdateSkillIds] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  const agentCounts = useMemo(
    () =>
      SKILL_AGENTS.map((agent) => ({
        ...agent,
        count: installed.filter((skill) => isSkillSyncedToAgent(skill, agent.id)).length,
      })),
    [installed],
  );

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredSkills = useMemo(() => {
    if (!normalizedSearch) return installed;

    return installed.filter((skill) => getSkillSearchText(skill).includes(normalizedSearch));
  }, [installed, normalizedSearch]);

  const totalPages = Math.max(1, Math.ceil(filteredSkills.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const visibleSkills = filteredSkills.slice(
    (safeCurrentPage - 1) * pageSize,
    safeCurrentPage * pageSize,
  );

  const handleToggleAgent = async (skill: InstalledSkill, agentId: SkillAgentId) => {
    const enabled = isSkillSyncedToAgent(skill, agentId);
    const key = `${skill.id}:${agentId}`;
    setActionError(null);
    setSyncingKey(key);
    try {
      await toggleApp(skill.id, agentId, !enabled);
    } catch (e) {
      setActionError(String(e));
    } finally {
      setSyncingKey(null);
    }
  };

  const handleDelete = async (skill: InstalledSkill) => {
    setActionError(null);
    setDeletingSkillId(skill.id);
    try {
      await uninstallSkill(skill.id);
      setUpdateSkillIds((ids) => ids.filter((id) => id !== skill.id));
    } catch (e) {
      setActionError(String(e));
    } finally {
      setDeletingSkillId(null);
    }
  };

  const handleCheckUpdates = async () => {
    setActionError(null);
    setCheckingUpdates(true);
    try {
      const results = await Promise.all(
        installed.map(async (skill) => {
          const result = await skillsService.checkSkillUpdates(skill.id);
          return { skillId: skill.id, hasUpdate: result.has_update };
        }),
      );
      setUpdateSkillIds(results.filter((result) => result.hasUpdate).map((result) => result.skillId));
    } catch (e) {
      setActionError(String(e));
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleUpdateAll = async () => {
    setActionError(null);
    setUpdatingAll(true);
    try {
      await Promise.all(updateSkillIds.map((skillId) => skillsService.updateSkill(skillId)));
      setUpdateSkillIds([]);
      await refetch();
    } catch (e) {
      setActionError(String(e));
    } finally {
      setUpdatingAll(false);
    }
  };

  const handleImportZip = async () => {
    setActionError(null);
    setImportingZip(true);
    try {
      const zipPath = await skillsService.openZipFileDialog();
      if (zipPath) {
        await skillsService.installSkillsFromZip(zipPath);
        await refetch();
      }
    } catch (e) {
      setActionError(String(e));
    } finally {
      setImportingZip(false);
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
    return <InstalledSkillsSkeleton />;
  }

  if (error) {
    return <div className="text-sm text-destructive">{error}</div>;
  }

  return (
    <TooltipProvider delayDuration={120}>
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        <div className="flex shrink-0 flex-col gap-3 px-1 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-1 flex-wrap items-center gap-2">
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
            <div className="flex shrink-0 items-center gap-2">
              <ManagementActionButton
                icon={RefreshCw}
                spin={checkingUpdates}
                disabled={checkingUpdates || updatingAll || installed.length === 0}
                onClick={handleCheckUpdates}
              >
                {checkingUpdates ? t('skills.checkingUpdates', '检查中...') : t('skills.checkUpdates', '检查更新')}
              </ManagementActionButton>
              {updateSkillIds.length > 0 ? (
                <ManagementActionButton
                  icon={RefreshCw}
                  spin={updatingAll}
                  disabled={updatingAll}
                  onClick={handleUpdateAll}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                >
                  {updatingAll
                    ? t('skills.updatingAll', '更新中...')
                    : t('skills.updateAll', `更新全部(${updateSkillIds.length})`, {
                        count: updateSkillIds.length,
                      })}
                </ManagementActionButton>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <ManagementSearchField
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder={t('skills.search.placeholder', '搜索 Skill / 描述 / 仓库')}
              className="max-w-[420px]"
            />

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <ManagementActionButton
                icon={Archive}
                disabled={importingZip}
                onClick={handleImportZip}
              >
                {importingZip ? t('skills.importingZip', '导入中...') : t('skills.importZip', '导入 ZIP')}
              </ManagementActionButton>
              <ManagementActionButton
                icon={FolderInput}
                onClick={() => setImportUnmanagedOpen(true)}
              >
                {t('skills.importUnmanaged.button', '导入已有')}
              </ManagementActionButton>
              <ManagementActionButton
                icon={History}
                onClick={() => setBackupRestoreOpen(true)}
              >
                {t('skills.backup.restore', '从备份恢复')}
              </ManagementActionButton>
            </div>
          </div>

          {actionError ? <div className="text-sm text-destructive">{actionError}</div> : null}
        </div>

        <div className="h-px shrink-0 bg-border" aria-hidden />

        <ScrollArea
          data-testid="skills-list-shell"
          className="min-h-0 min-w-0 flex-1"
        >
          {visibleSkills.length > 0 ? (
            <div className="flex flex-col gap-1.5 p-1">
              {visibleSkills.map((skill) => (
                <SkillListRow
                  key={skill.id}
                  skill={skill}
                  hasUpdate={updateSkillIds.includes(skill.id)}
                  syncingKey={syncingKey}
                  deletingSkillId={deletingSkillId}
                  onToggleAgent={handleToggleAgent}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          ) : (
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 px-6 py-10 text-center">
              <p className="text-sm font-medium text-foreground">
                {installed.length === 0
                  ? t('skills.empty', '暂无已安装的 Skills')
                  : t('skills.search.empty', '没有找到匹配的 Skill')}
              </p>
              <p className="text-xs text-muted-foreground">
                {installed.length === 0
                  ? t('skills.emptyHint', '可以从 ZIP 导入，或切换到发现技能。')
                  : t('skills.search.emptyHint', '换个关键词再试试。')}
              </p>
              {installed.length === 0 ? (
                <ManagementActionButton icon={Archive} onClick={handleImportZip}>
                  {t('skills.importZip', '导入 ZIP')}
                </ManagementActionButton>
              ) : null}
            </div>
          )}
        </ScrollArea>

        {visibleSkills.length > 0 ? (
          <div className="shrink-0">
            <ManagementPaginationBar
              testId="skills-pagination-row"
              total={filteredSkills.length}
              currentPage={safeCurrentPage}
              pageSize={pageSize}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              onPageChange={setCurrentPage}
              onPageSizeChange={handlePageSizeChange}
            />
          </div>
        ) : null}
      </div>
      <ImportUnmanagedDialog
        open={importUnmanagedOpen}
        onOpenChange={setImportUnmanagedOpen}
        onImported={() => {
          void refetch();
        }}
      />
      <BackupRestoreDialog
        open={backupRestoreOpen}
        onOpenChange={setBackupRestoreOpen}
        onRestored={() => {
          void refetch();
        }}
      />
    </TooltipProvider>
  );
}

function SkillListRow({
  skill,
  hasUpdate,
  syncingKey,
  deletingSkillId,
  onToggleAgent,
  onDelete,
}: {
  skill: InstalledSkill;
  hasUpdate: boolean;
  syncingKey: string | null;
  deletingSkillId: string | null;
  onToggleAgent: (skill: InstalledSkill, agentId: SkillAgentId) => void;
  onDelete: (skill: InstalledSkill) => void;
}) {
  return (
    <div
      className={cn(
        'grid min-h-[92px] grid-cols-1 gap-3 px-4 py-3 transition-colors md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center md:gap-4',
        'rounded-[10px] border border-border bg-card hover:bg-muted/40',
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <SkillGlyph skill={skill} />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="truncate text-[14px] font-semibold leading-5 text-foreground">
              {skill.name}
            </div>
            {hasUpdate ? (
              <Badge className="h-5 rounded-[6px] px-1.5 text-[11px] font-medium">
                有更新
              </Badge>
            ) : null}
          </div>
          <SkillSource skill={skill} />
          {skill.description ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="line-clamp-1 cursor-default text-[12.5px] leading-5 text-muted-foreground">
                  {skill.description}
                </p>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                align="start"
                className="max-w-[320px] whitespace-normal text-left leading-relaxed [&>span]:!block [&>span]:!text-left"
              >
                {skill.description}
              </TooltipContent>
            </Tooltip>
          ) : (
            <p className="line-clamp-1 text-[12.5px] leading-5 text-muted-foreground">暂无简介</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 md:justify-end">
        {SKILL_AGENTS.map((agent) => (
          <AgentSyncButton
            key={agent.id}
            skill={skill}
            agentId={agent.id}
            agentLabel={agent.label}
            disabled={syncingKey === `${skill.id}:${agent.id}`}
            onToggle={() => onToggleAgent(skill, agent.id)}
          />
        ))}
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`删除 ${skill.name}`}
            disabled={deletingSkillId === skill.id}
            className="justify-self-start text-muted-foreground hover:text-destructive md:justify-self-end"
            onClick={() => onDelete(skill)}
          >
            <Trash2 aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent>删除</TooltipContent>
      </Tooltip>
    </div>
  );
}

function SkillSource({ skill }: { skill: InstalledSkill }) {
  const repoLabel = skill.repo_owner && skill.repo_name
    ? `${skill.repo_owner}/${skill.repo_name}`
    : null;
  const repoUrl = repoLabel ? `https://github.com/${repoLabel}` : null;

  if (repoLabel && repoUrl) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <Badge variant="outline" className="h-5 rounded-[6px] px-1.5 text-[11px] font-medium">
          仓库
        </Badge>
        <a
          href={repoUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-w-0 items-center gap-1 text-[12px] font-medium text-primary hover:underline"
        >
          <span className="truncate">{repoLabel}</span>
          <ExternalLink className="size-3.5 shrink-0" aria-hidden />
        </a>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Badge variant="secondary" className="h-5 rounded-[6px] px-1.5 text-[11px] font-medium">
        本地
      </Badge>
      <span className="truncate text-[12px] text-muted-foreground">{skill.directory}</span>
    </div>
  );
}

function AgentSyncButton({
  skill,
  agentId,
  agentLabel,
  disabled,
  onToggle,
}: {
  skill: InstalledSkill;
  agentId: SkillAgentId;
  agentLabel: string;
  disabled: boolean;
  onToggle: () => void;
}) {
  const enabled = isSkillSyncedToAgent(skill, agentId);
  const ariaLabel = enabled
    ? `取消同步 ${skill.name} 到 ${agentLabel}`
    : `同步 ${skill.name} 到 ${agentLabel}`;

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

function SkillGlyph({ skill }: { skill: InstalledSkill }) {
  const Icon = getSkillIcon(skill);

  return (
    <div className="inline-flex size-11 shrink-0 items-center justify-center rounded-[8px] border border-border bg-background text-primary shadow-sm">
      <Icon className="size-5" strokeWidth={1.85} aria-hidden />
    </div>
  );
}

function InstalledSkillsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {SKILL_AGENTS.map((agent) => (
          <Skeleton key={agent.id} className="h-8 w-24 rounded-[8px]" />
        ))}
      </div>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-9 w-[360px] rounded-[8px]" />
        <Skeleton className="h-9 w-[320px] rounded-[8px]" />
      </div>
      <Skeleton className="h-[300px] rounded-[8px]" />
    </div>
  );
}

function isSkillSyncedToAgent(skill: InstalledSkill, agentId: SkillAgentId) {
  return Boolean(skill.apps[agentId]);
}

function getSkillSearchText(skill: InstalledSkill) {
  return [
    skill.name,
    skill.description,
    skill.directory,
    skill.repo_owner,
    skill.repo_name,
    skill.repo_owner && skill.repo_name ? `${skill.repo_owner}/${skill.repo_name}` : null,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function getSkillIcon(skill: InstalledSkill): ComponentType<LucideProps> {
  const haystack = `${skill.directory} ${skill.name}`.toLowerCase();

  if (haystack.includes('browser')) return Globe2;
  if (haystack.includes('image')) return FileImage;
  if (haystack.includes('xlsx') || haystack.includes('sheet')) return FileSpreadsheet;
  if (haystack.includes('ppt') || haystack.includes('slide')) return Presentation;
  if (haystack.includes('doc')) return BookOpen;
  if (haystack.includes('code') || haystack.includes('plugin')) return Code2;
  return Puzzle;
}
