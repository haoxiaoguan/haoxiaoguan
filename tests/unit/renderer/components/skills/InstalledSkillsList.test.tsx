import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstalledSkill } from '@/types';
import { InstalledSkillsList } from '@/components/skills/InstalledSkillsList';

const mocks = vi.hoisted(() => ({
  refetch: vi.fn(),
  toggleApp: vi.fn(),
  uninstallSkill: vi.fn(),
  checkSkillUpdates: vi.fn(),
  updateSkill: vi.fn(),
  openZipFileDialog: vi.fn(),
  installSkillsFromZip: vi.fn(),
}));

const installedSkills: InstalledSkill[] = [
  {
    id: 'imagegen',
    name: 'Image Forge',
    description: 'Generate production-ready image assets.',
    directory: 'imagegen',
    repo_owner: 'openai',
    repo_name: 'skills',
    repo_branch: 'main',
    readme_url: 'https://github.com/openai/skills/tree/main/imagegen',
    apps: {
      claude: true,
      codex: false,
      gemini: false,
      opencode: true,
      hermes: false,
    },
    installed_at: 1,
    updated_at: 2,
    ssot_path: '/skills/imagegen',
    storage_location: 'haoxiaoguan',
  },
  {
    id: 'browser',
    name: 'Browser Runner',
    description: 'Automate browser workflows.',
    directory: 'browser',
    repo_owner: 'vercel',
    repo_name: 'agent-browser',
    repo_branch: 'main',
    apps: {
      claude: false,
      codex: true,
      gemini: false,
      opencode: false,
      hermes: true,
    },
    installed_at: 1,
    updated_at: 2,
    ssot_path: '/skills/browser',
    storage_location: 'haoxiaoguan',
  },
];
const installedSkillsFixture = installedSkills.map((skill) => ({
  ...skill,
  apps: { ...skill.apps },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@/hooks/useSkills', () => ({
  useSkills: () => ({
    installed: installedSkills,
    loading: false,
    error: null,
    refetch: mocks.refetch,
  }),
  useSkillsDiscover: () => ({
    discoverable: [],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/stores/skillsStore', () => ({
  useSkillsStore: () => ({
    toggleApp: mocks.toggleApp,
    uninstallSkill: mocks.uninstallSkill,
    installSkill: vi.fn(),
  }),
}));

vi.mock('@/services/tauri', () => ({
  skillsService: {
    checkSkillUpdates: mocks.checkSkillUpdates,
    updateSkill: mocks.updateSkill,
    openZipFileDialog: mocks.openZipFileDialog,
    installSkillsFromZip: mocks.installSkillsFromZip,
  },
}));

describe('Skills 管理页', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installedSkills.splice(
      0,
      installedSkills.length,
      ...installedSkillsFixture.map((skill) => ({
        ...skill,
        apps: { ...skill.apps },
      })),
    );
    mocks.checkSkillUpdates.mockResolvedValue({ has_update: false });
    mocks.updateSkill.mockResolvedValue(installedSkills[0]);
    mocks.openZipFileDialog.mockResolvedValue(null);
    mocks.installSkillsFromZip.mockResolvedValue([]);
  });

  it('按高保真展示 Agent 彩色统计、搜索框和仓库外链，不再展示表头/筛选/状态列', () => {
    render(<InstalledSkillsList />);

    expect(screen.getByText('Claude: 1')).toBeInTheDocument();
    expect(screen.getByText('Codex: 1')).toBeInTheDocument();
    expect(screen.getByText('Gemini: 0')).toBeInTheDocument();
    expect(screen.getByText('OpenCode: 1')).toBeInTheDocument();
    expect(screen.getByText('Hermes: 1')).toBeInTheDocument();

    expect(screen.getByText('Image Forge')).toBeInTheDocument();
    expect(screen.getByText('Generate production-ready image assets.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('搜索 Skill / 描述 / 仓库')).toBeInTheDocument();
    // 分页栏固定在滚动列表外，不应嵌套在滚动容器内
    const listShell = screen.getByTestId('skills-list-shell');
    expect(within(listShell).queryByTestId('skills-pagination-row')).not.toBeInTheDocument();
    const paginationRow = screen.getByTestId('skills-pagination-row');
    expect(within(paginationRow).getByText('共 2 项')).toBeInTheDocument();

    const repoLink = screen.getByRole('link', { name: 'openai/skills' });
    expect(repoLink).toHaveAttribute('href', 'https://github.com/openai/skills');
    expect(repoLink).toHaveAttribute('target', '_blank');

    expect(screen.queryByText('Agent：全部')).not.toBeInTheDocument();
    expect(screen.queryByText('状态：全部')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '名称 / 简介' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '状态' })).not.toBeInTheDocument();
  });

  it('没有数据时只展示空态，不显示无意义分页', () => {
    installedSkills.splice(0, installedSkills.length);

    render(<InstalledSkillsList />);

    expect(screen.getByText('暂无已安装的 Skills')).toBeInTheDocument();
    expect(screen.queryByTestId('skills-pagination-row')).not.toBeInTheDocument();
    expect(screen.queryByText('共 0 项')).not.toBeInTheDocument();
  });

  it('可以用搜索框按名称、描述或仓库过滤列表', () => {
    render(<InstalledSkillsList />);

    fireEvent.change(screen.getByPlaceholderText('搜索 Skill / 描述 / 仓库'), {
      target: { value: 'vercel' },
    });

    expect(screen.getByText('Browser Runner')).toBeInTheDocument();
    expect(screen.queryByText('Image Forge')).not.toBeInTheDocument();
    expect(screen.getByText('共 1 项')).toBeInTheDocument();
  });

  it('用行内 Agent 图标按钮同步或取消同步指定 agent', () => {
    render(<InstalledSkillsList />);

    fireEvent.click(screen.getByRole('button', { name: '取消同步 Image Forge 到 Claude' }));
    fireEvent.click(screen.getByRole('button', { name: '同步 Image Forge 到 Codex' }));

    expect(mocks.toggleApp).toHaveBeenCalledWith('imagegen', 'claude', false);
    expect(mocks.toggleApp).toHaveBeenCalledWith('imagegen', 'codex', true);
  });

  it('每行操作只保留删除，并调用卸载接口', () => {
    render(<InstalledSkillsList />);

    expect(screen.getByRole('button', { name: '删除 Image Forge' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '删除 Image Forge' }));

    expect(mocks.uninstallSkill).toHaveBeenCalledWith('imagegen');
  });

  it('检查更新后只在有更新时显示更新全部按钮', async () => {
    mocks.checkSkillUpdates
      .mockResolvedValueOnce({ has_update: true })
      .mockResolvedValueOnce({ has_update: false });

    render(<InstalledSkillsList />);

    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));

    expect(await screen.findByRole('button', { name: '更新全部(1)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '更新全部(1)' }));

    await waitFor(() => {
      expect(mocks.updateSkill).toHaveBeenCalledWith('imagegen');
      expect(mocks.refetch).toHaveBeenCalled();
    });
  });
});
