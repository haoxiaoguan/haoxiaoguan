import { useMemo, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowUpCircle,
  BookOpen,
  CheckCircle2,
  Code2,
  Download,
  ExternalLink,
  FileImage,
  FileSpreadsheet,
  Globe2,
  Presentation,
  Puzzle,
  RefreshCw,
  Settings2,
  Users,
  type LucideProps,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ManagementActionButton,
  ManagementInfoPill,
  ManagementPaginationBar,
  ManagementSearchField,
} from '@/components/management/ManagementControls';
import { cn } from '@/lib/utils';
import { useSkills, useSkillsDiscover } from '../../hooks/useSkills';
import { skillsService } from '../../services/tauri';
import { useSkillsStore } from '../../stores/skillsStore';
import type { DiscoverableSkill, InstalledSkill } from '../../types';
import { AgentLogo, SKILL_AGENTS } from './AgentLogo';
import { SkillRepoManagerDialog } from './SkillRepoManagerDialog';

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [20, 50, 100];

/** 官方仓库 owner 白名单（可被识别为「官方」标签） */
const OFFICIAL_OWNERS = new Set(['openai', 'anthropic', 'vercel']);

interface DiscoverState {
  installed: InstalledSkill[];
  installedById: Map<string, InstalledSkill>;
}

export function DiscoverSkillsList() {
  const { t } = useTranslation();
  const { discoverable, loading, error, refetch } = useSkillsDiscover();
  const { installed } = useSkills();
  const { installSkill } = useSkillsStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [refreshing, setRefreshing] = useState(false);
  const [installingDir, setInstallingDir] = useState<string | null>(null);
  const [bulkInstalling, setBulkInstalling] = useState(false);
  const [selectedDirs, setSelectedDirs] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [updateDirs, setUpdateDirs] = useState<Set<string>>(new Set());
  const [repoDialogOpen, setRepoDialogOpen] = useState(false);

  const state: DiscoverState = useMemo(() => {
    const map = new Map<string, InstalledSkill>();
    for (const skill of installed) map.set(skill.directory, skill);
    return { installed, installedById: map };
  }, [installed]);

  const counts = useMemo(() => {
    let official = 0;
    let community = 0;
    for (const skill of discoverable) {
      if (isOfficial(skill)) official += 1;
      else community += 1;
    }
    return {
      official,
      community,
      updatable: updateDirs.size,
      installed: installed.length,
    };
  }, [discoverable, updateDirs, installed.length]);

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!normalizedSearch) return discoverable;
    return discoverable.filter((skill) => getSearchText(skill).includes(normalizedSearch));
  }, [discoverable, normalizedSearch]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  };

  const handlePageSizeChange = (next: number) => {
    setPageSize(next);
    setCurrentPage(1);
  };

  const handleRefresh = async () => {
    setActionError(null);
    setRefreshing(true);
    try {
      await refetch();
    } catch (e) {
      setActionError(String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const handleInstall = async (skill: DiscoverableSkill) => {
    setActionError(null);
    setInstallingDir(skill.directory);
    try {
      await installSkill(skill, 'claude');
    } catch (e) {
      setActionError(String(e));
    } finally {
      setInstallingDir(null);
    }
  };

  const handleUpdate = async (skill: DiscoverableSkill) => {
    const installedSkill = state.installedById.get(skill.directory);
    if (!installedSkill) return;
    setActionError(null);
    setInstallingDir(skill.directory);
    try {
      await skillsService.updateSkill(installedSkill.id);
      setUpdateDirs((prev) => {
        const next = new Set(prev);
        next.delete(skill.directory);
        return next;
      });
    } catch (e) {
      setActionError(String(e));
    } finally {
      setInstallingDir(null);
    }
  };

  const handleBulkInstall = async () => {
    if (selectedDirs.size === 0) return;
    setActionError(null);
    setBulkInstalling(true);
    try {
      const targets = discoverable.filter(
        (skill) =>
          selectedDirs.has(skill.directory) && !state.installedById.has(skill.directory),
      );
      for (const target of targets) {
        await installSkill(target, 'claude');
      }
      setSelectedDirs(new Set());
    } catch (e) {
      setActionError(String(e));
    } finally {
      setBulkInstalling(false);
    }
  };

  const toggleSelect = (dirName: string, installed: boolean) => {
    if (installed) return;
    setSelectedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirName)) next.delete(dirName);
      else next.add(dirName);
      return next;
    });
  };

  if (loading && discoverable.length === 0) {
    return <DiscoverSkeleton />;
  }

  const installableSelected = Array.from(selectedDirs).filter(
    (dir) => !state.installedById.has(dir),
  ).length;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 flex-col gap-3 px-1 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <ManagementInfoPill
            tone="blue"
            className="h-9 rounded-[10px] px-3 text-[13px]"
            icon={CheckCircle2}
            label={t('skills.discover.officialCount', `官方源: ${counts.official}`, {
              count: counts.official,
            })}
          />
          <ManagementInfoPill
            tone="green"
            className="h-9 rounded-[10px] px-3 text-[13px]"
            icon={Users}
            label={t('skills.discover.communityCount', `社区源: ${counts.community}`, {
              count: counts.community,
            })}
          />
          <ManagementInfoPill
            tone="orange"
            className="h-9 rounded-[10px] px-3 text-[13px]"
            icon={ArrowUpCircle}
            label={t('skills.discover.updatableCount', `可更新: ${counts.updatable}`, {
              count: counts.updatable,
            })}
          />
          <ManagementInfoPill
            tone="slate"
            className="h-9 rounded-[10px] px-3 text-[13px]"
            icon={Download}
            label={t('skills.discover.installedCount', `已安装: ${counts.installed}`, {
              count: counts.installed,
            })}
          />
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <ManagementSearchField
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder={t('skills.discover.search.placeholder', '搜索 Skill / 描述 / 仓库')}
            className="max-w-[420px]"
          />

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <ManagementActionButton
              icon={RefreshCw}
              spin={refreshing}
              disabled={refreshing}
              onClick={handleRefresh}
            >
              {refreshing
                ? t('skills.discover.refreshing', '刷新中...')
                : t('skills.discover.refresh', '刷新远端')}
            </ManagementActionButton>
            <ManagementActionButton
              icon={Download}
              disabled={installableSelected === 0 || bulkInstalling}
              onClick={handleBulkInstall}
            >
              {bulkInstalling
                ? t('skills.discover.installingSelected', '安装中...')
                : t(
                    'skills.discover.installSelected',
                    `安装所选${installableSelected > 0 ? `(${installableSelected})` : ''}`,
                    { count: installableSelected },
                  )}
            </ManagementActionButton>
            <ManagementActionButton
              icon={Settings2}
              onClick={() => setRepoDialogOpen(true)}
            >
              {t('skills.discover.manageRepos', '仓库管理')}
            </ManagementActionButton>
          </div>
        </div>

        {actionError ? <div className="text-sm text-destructive">{actionError}</div> : null}
      </div>

      <div className="h-px shrink-0 bg-border" aria-hidden />

      <ScrollArea
        data-testid="discover-list-shell"
        className="min-h-0 min-w-0 flex-1"
      >
        <div className="px-1 py-3">
          {visible.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visible.map((skill) => {
                const key = `${skill.repo_owner}/${skill.repo_name}/${skill.directory}`;
                const installedSkill = state.installedById.get(skill.directory);
                const isInstalled = Boolean(installedSkill);
                const hasUpdate = updateDirs.has(skill.directory);
                const isBusy = installingDir === skill.directory;
                const checked = selectedDirs.has(skill.directory);
                return (
                  <DiscoverSkillCard
                    key={key}
                    skill={skill}
                    isInstalled={isInstalled}
                    hasUpdate={hasUpdate}
                    isBusy={isBusy}
                    checked={checked}
                    onToggleSelect={() => toggleSelect(skill.directory, isInstalled)}
                    onInstall={() => handleInstall(skill)}
                    onUpdate={() => handleUpdate(skill)}
                  />
                );
              })}
            </div>
          ) : (
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 px-6 py-10 text-center">
              <p className="text-sm font-medium text-foreground">
                {error ?? t('skills.discover.empty', '暂无可发现的 Skills')}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('skills.discover.emptyHint', '请检查仓库配置或网络连接')}
              </p>
            </div>
          )}
        </div>
      </ScrollArea>

      {visible.length > 0 ? (
        <div className="shrink-0 border-t border-border/80">
          <ManagementPaginationBar
            testId="discover-pagination-row"
            total={filtered.length}
            currentPage={safePage}
            pageSize={pageSize}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageChange={setCurrentPage}
            onPageSizeChange={handlePageSizeChange}
            className="border-t-0"
          />
        </div>
      ) : null}

      <SkillRepoManagerDialog
        open={repoDialogOpen}
        onOpenChange={setRepoDialogOpen}
        onChanged={refetch}
      />
    </div>
  );
}

function DiscoverSkillCard({
  skill,
  isInstalled,
  hasUpdate,
  isBusy,
  checked,
  onToggleSelect,
  onInstall,
  onUpdate,
}: {
  skill: DiscoverableSkill;
  isInstalled: boolean;
  hasUpdate: boolean;
  isBusy: boolean;
  checked: boolean;
  onToggleSelect: () => void;
  onInstall: () => void;
  onUpdate: () => void;
}) {
  const Icon = getSkillIcon(skill);
  const repoLabel = `${skill.repo_owner}/${skill.repo_name}`;
  const repoUrl = `https://github.com/${repoLabel}`;
  const official = isOfficial(skill);
  const supportsAllAgents = !isInstalled;

  return (
    <div
      className={cn(
        'group flex flex-col gap-3 rounded-[12px] border border-border bg-card p-3.5 transition-colors',
        isInstalled ? 'opacity-95' : 'hover:bg-muted/30',
        checked && !isInstalled && 'border-primary/40 bg-primary/[0.04]',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] border border-border bg-background text-primary shadow-sm">
          <Icon className="size-5" strokeWidth={1.85} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[14px] font-semibold leading-5 text-foreground">
              {skill.name}
            </span>
            {official ? (
              <Badge className="h-5 rounded-[6px] bg-primary/10 px-1.5 text-[11px] font-medium text-primary hover:bg-primary/15">
                官方
              </Badge>
            ) : (
              <Badge
                variant="secondary"
                className="h-5 rounded-[6px] bg-emerald-500/10 px-1.5 text-[11px] font-medium text-emerald-600 hover:bg-emerald-500/15"
              >
                社区
              </Badge>
            )}
            {hasUpdate ? (
              <Badge
                variant="outline"
                className="h-5 rounded-[6px] border-orange-500/30 px-1.5 text-[11px] font-medium text-orange-600"
              >
                可更新
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 line-clamp-2 text-[12.5px] leading-5 text-muted-foreground">
            {skill.description ?? '暂无简介'}
          </p>
          <a
            href={repoUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1.5 inline-flex min-w-0 items-center gap-1 text-[12px] font-medium text-primary hover:underline"
          >
            <span className="truncate">{repoLabel}</span>
            <ExternalLink className="size-3 shrink-0" aria-hidden />
          </a>
        </div>
        <Checkbox
          className="mt-1"
          checked={checked}
          disabled={isInstalled}
          onCheckedChange={onToggleSelect}
          aria-label={`选择 ${skill.name}`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {SKILL_AGENTS.map((agent) => (
          <div
            key={agent.id}
            className="flex flex-col items-center gap-0.5"
            aria-label={`${agent.label} 支持`}
          >
            <AgentLogo
              agentId={agent.id}
              className={cn(
                'size-7 rounded-[7px] border-0 bg-transparent shadow-none',
                !supportsAllAgents && 'opacity-50 grayscale',
              )}
              imageClassName="size-5"
            />
            <span className="text-[10.5px] leading-none text-muted-foreground">
              {agent.label}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-auto flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={isInstalled && !hasUpdate ? 'outline' : 'default'}
          disabled={(isInstalled && !hasUpdate) || isBusy}
          className="h-8 flex-1 rounded-[8px] text-[12px]"
          onClick={hasUpdate ? onUpdate : onInstall}
        >
          {isBusy
            ? '处理中...'
            : hasUpdate
              ? '更新'
              : isInstalled
                ? '已安装'
                : '安装'}
        </Button>
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label="更多操作"
          className="h-8 w-8 rounded-[8px]"
        >
          <span className="text-[14px] leading-none text-muted-foreground">…</span>
        </Button>
      </div>
    </div>
  );
}

function DiscoverSkeleton() {
  return (
    <div className="flex h-full flex-col gap-3 px-1 pb-3">
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, idx) => (
          <Skeleton key={idx} className="h-9 w-28 rounded-[10px]" />
        ))}
      </div>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-9 w-[360px] rounded-[8px]" />
        <Skeleton className="h-9 w-[300px] rounded-[8px]" />
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, idx) => (
          <Skeleton key={idx} className="h-[200px] rounded-[12px]" />
        ))}
      </div>
    </div>
  );
}

function isOfficial(skill: DiscoverableSkill) {
  return OFFICIAL_OWNERS.has(skill.repo_owner.toLowerCase());
}

function getSearchText(skill: DiscoverableSkill) {
  return [
    skill.name,
    skill.description,
    skill.directory,
    skill.repo_owner,
    skill.repo_name,
    `${skill.repo_owner}/${skill.repo_name}`,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function getSkillIcon(skill: DiscoverableSkill): ComponentType<LucideProps> {
  const haystack = `${skill.directory} ${skill.name}`.toLowerCase();
  if (haystack.includes('browser')) return Globe2;
  if (haystack.includes('image')) return FileImage;
  if (haystack.includes('xlsx') || haystack.includes('sheet') || haystack.includes('spreadsheet'))
    return FileSpreadsheet;
  if (haystack.includes('ppt') || haystack.includes('presentation') || haystack.includes('slide'))
    return Presentation;
  if (haystack.includes('doc')) return BookOpen;
  if (haystack.includes('code') || haystack.includes('plugin') || haystack.includes('review'))
    return Code2;
  return Puzzle;
}
