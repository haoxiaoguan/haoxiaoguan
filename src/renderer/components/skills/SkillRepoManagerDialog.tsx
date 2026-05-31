import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { skillsService } from '../../services/tauri';
import type { SkillRepo } from '../../types';

interface SkillRepoManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 仓库增删后回调，供外部刷新发现列表。 */
  onChanged?: () => void;
}

export function SkillRepoManagerDialog({
  open,
  onOpenChange,
  onChanged,
}: SkillRepoManagerDialogProps) {
  const { t } = useTranslation();
  const [repos, setRepos] = useState<SkillRepo[]>([]);
  const [newOwner, setNewOwner] = useState('');
  const [newName, setNewName] = useState('');
  const [newBranch, setNewBranch] = useState('main');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      void loadRepos();
    }
  }, [open]);

  const loadRepos = async () => {
    try {
      const data = await skillsService.getSkillRepos();
      setRepos(data);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleAdd = async () => {
    if (!newOwner.trim() || !newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await skillsService.addSkillRepo({
        owner: newOwner.trim(),
        name: newName.trim(),
        branch: newBranch.trim() || 'main',
      });
      setNewOwner('');
      setNewName('');
      setNewBranch('main');
      await loadRepos();
      onChanged?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (owner: string, name: string) => {
    setBusy(true);
    setError(null);
    try {
      await skillsService.removeSkillRepo({ owner, name });
      await loadRepos();
      onChanged?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('skills.settings.repos', 'Skill 仓库')}</DialogTitle>
          <DialogDescription>
            {t('skills.discover.repoDialogDesc', '管理用于发现 Skill 的 GitHub 仓库来源。')}
          </DialogDescription>
        </DialogHeader>

        {/* 仓库列表 */}
        <ScrollArea className="max-h-[280px] min-h-[60px]">
          <div className="space-y-2 pr-2">
            {repos.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                {t('skills.discover.repoEmpty', '暂无仓库，添加一个开始发现 Skill。')}
              </p>
            ) : (
              repos.map((repo) => (
                <div
                  key={`${repo.owner}/${repo.name}`}
                  className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-medium">
                      {repo.owner}/{repo.name}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">({repo.branch})</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-destructive"
                    disabled={busy}
                    aria-label={t('common.delete', '删除')}
                    onClick={() => handleRemove(repo.owner, repo.name)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        {/* 添加新仓库 */}
        <div className="flex items-center gap-2">
          <Input
            placeholder="owner"
            value={newOwner}
            onChange={(e) => setNewOwner(e.target.value)}
            className="h-8 flex-1"
          />
          <span className="text-muted-foreground">/</span>
          <Input
            placeholder="name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="h-8 flex-1"
          />
          <Input
            placeholder="branch"
            value={newBranch}
            onChange={(e) => setNewBranch(e.target.value)}
            className="h-8 w-24"
          />
          <Button
            type="button"
            size="sm"
            disabled={busy || !newOwner.trim() || !newName.trim()}
            onClick={handleAdd}
          >
            {t('common.add', '添加')}
          </Button>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
