/**
 * 仅开发期使用的 invoke 模拟器：当 URL 携带 `?mock=accounts` 时注入。
 * 用于在浏览器（无 Tauri runtime）下截图对比设计稿。
 *
 * 进入生产构建后可被 tree-shake / 不被引用即可。
 */
import type { McpServer } from '../types';

const SAMPLE_ACCOUNTS = [
  {
    id: 'cursor-pro',
    platform: 'cursor',
    email: 'bubblecam@126.com',
    identityKey: 'auth0-user_abc123',
    displayIdentifier: 'bubblecam@126.com',
    name: 'Cursor Pro',
    planName: 'PRO',
    planTier: 'pro',
    status: 'active',
    profilePayload: { userId: 'auth0|user_abc123' },
    tags: ['Cursor', 'PRO'],
    notes: '',
    isActive: false,
    createdAt: '2025-04-12T10:21:00Z',
    lastUsedAt: '2026-05-25T07:44:00Z',
  },
  {
    id: 'gemini-lab',
    platform: 'gemini-cli',
    email: 'veoanti75839155@1mar...',
    identityKey: 'gemini-user-1',
    displayIdentifier: 'gemini@example.com',
    name: 'Gemini CLI Lab',
    planName: 'Google AI Pro',
    planTier: 'pro',
    status: 'active',
    profilePayload: { quota: { pro: { remainingPercent: 0 }, flash: { remainingPercent: 100 } } },
    tags: ['Gemini CLI', 'Flash'],
    notes: '',
    isActive: false,
    createdAt: '2026-02-10T03:00:00Z',
    lastUsedAt: '2026-05-25T07:45:00Z',
  },
  {
    id: 'kiro-main',
    platform: 'kiro',
    email: 'dev@haoxiaoguan.dev',
    identityKey: 'd-9067c98495.449',
    displayIdentifier: 'D-9067C98495.449',
    loginProvider: 'AWS SSO',
    planName: 'Kiro Pro',
    planTier: 'pro',
    status: 'active',
    profilePayload: { creditsTotal: 100, creditsUsed: 25 },
    name: 'Kiro 主账号',
    tags: ['主力', 'AWS SSO'],
    notes: '',
    isActive: true,
    createdAt: '2025-06-22T09:00:00Z',
    lastUsedAt: '2026-05-25T07:46:00Z',
  },
  {
    id: 'copilot-tm',
    platform: 'github-copilot',
    email: 'team@github.com',
    identityKey: '12345',
    displayIdentifier: 'octocat',
    loginProvider: 'GitHub',
    planName: 'Team',
    status: 'active',
    profilePayload: { deviceCode: true },
    name: 'GitHub Copilot Team',
    tags: ['团队', 'device code'],
    notes: '',
    isActive: false,
    createdAt: '2025-09-12T03:00:00Z',
    lastUsedAt: '2026-05-25T01:41:00Z',
  },
  {
    id: 'codex-api',
    platform: 'codex',
    email: 'openai@work.dev',
    identityKey: 'org-user-123',
    displayIdentifier: 'openai@work.dev',
    loginProvider: 'chatgpt_oauth',
    planName: 'Plus',
    status: 'active',
    profilePayload: {
      subscriptionActiveUntil: '2026-06-25T23:59:00Z',
      quota: {
        hourly_percentage: 35,
        hourly_window_minutes: 300,
        hourly_window_present: true,
        weekly_percentage: 80,
        weekly_window_minutes: 10080,
        weekly_window_present: true,
      },
    },
    name: 'Codex API',
    tags: ['CLI', 'token json'],
    notes: '',
    isActive: false,
    createdAt: '2026-01-02T03:00:00Z',
    lastUsedAt: '2026-05-24T01:00:00Z',
  },
  {
    id: 'wind-back',
    platform: 'windsurf',
    email: 'windsurf@work.dev',
    identityKey: 'windsurf-user-1',
    displayIdentifier: 'windsurf@work.dev',
    planTier: 'backup',
    status: 'expired',
    profilePayload: {},
    name: 'Windsurf 备用',
    tags: ['备用'],
    notes: '',
    isActive: false,
    createdAt: '2025-07-01T12:00:00Z',
    lastUsedAt: '2026-05-22T20:00:00Z',
  },
  {
    id: 'antigravity-local',
    platform: 'antigravity',
    email: 'antigravity@work.dev',
    identityKey: 'google-user-1',
    displayIdentifier: 'antigravity@work.dev',
    planName: 'Google Cloud Code',
    planTier: 'pro',
    status: 'active',
    profilePayload: { usage: { used: 36, total: 100, unit: 'credits' } },
    name: 'Antigravity IDE',
    tags: ['本地导入'],
    notes: '',
    isActive: false,
    createdAt: '2026-04-08T03:00:00Z',
    lastUsedAt: '2026-05-25T08:00:00Z',
  },
  {
    id: 'qoder-beta',
    platform: 'qoder',
    email: 'qoder@team.io',
    identityKey: 'qoder-user-1',
    displayIdentifier: 'qoder@team.io',
    planTier: 'beta',
    status: 'limited',
    profilePayload: { usage: { used: 12, total: 30 } },
    name: 'Qoder Beta',
    tags: ['Beta'],
    notes: '',
    isActive: false,
    createdAt: '2026-03-05T03:00:00Z',
    lastUsedAt: undefined,
  },
  {
    id: 'zed-keychain',
    platform: 'zed',
    email: 'zed@team.io',
    identityKey: 'zed-user-1',
    displayIdentifier: 'zed.dev',
    planTier: 'plus',
    status: 'active',
    profilePayload: { usage: { used: 210000, total: 500000, unit: 'tokens' } },
    name: 'Zed Keychain',
    tags: ['Keychain'],
    notes: '',
    isActive: false,
    createdAt: '2026-03-11T03:00:00Z',
    lastUsedAt: '2026-05-23T12:00:00Z',
  },
  {
    id: 'trae-team',
    platform: 'trae',
    email: 'trae@team.io',
    identityKey: 'trae-user-1',
    displayIdentifier: 'trae@team.io',
    planName: 'Team',
    status: 'active',
    profilePayload: { usage: { used: 18, total: 100, unit: 'credits' } },
    name: 'Trae Team',
    tags: ['团队'],
    notes: '',
    isActive: false,
    createdAt: '2026-04-01T03:00:00Z',
    lastUsedAt: '2026-05-20T12:00:00Z',
  },
  {
    id: 'codebuddy-global',
    platform: 'codebuddy',
    email: 'codebuddy@team.io',
    identityKey: 'codebuddy-user-1',
    displayIdentifier: 'codebuddy@team.io',
    loginProvider: 'Tencent',
    planName: 'Pro',
    status: 'active',
    profilePayload: { usage: { used: 28, total: 60, unit: 'credits' } },
    name: 'CodeBuddy Global',
    tags: ['Global'],
    notes: '',
    isActive: false,
    createdAt: '2026-04-02T03:00:00Z',
    lastUsedAt: '2026-05-20T13:00:00Z',
  },
  {
    id: 'codebuddy-cn',
    platform: 'codebuddy-cn',
    email: 'codebuddy-cn@team.io',
    identityKey: 'codebuddy-cn-user-1',
    displayIdentifier: 'codebuddy-cn@team.io',
    loginProvider: 'Tencent',
    planName: '团队版',
    status: 'active',
    profilePayload: { usage: { used: 8, total: 50, unit: 'credits' } },
    name: 'CodeBuddy CN',
    tags: ['CN'],
    notes: '',
    isActive: false,
    createdAt: '2026-04-03T03:00:00Z',
    lastUsedAt: '2026-05-20T14:00:00Z',
  },
];

const PLATFORM_NAMES: Record<string, string> = {
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  antigravity: 'Antigravity IDE',
  kiro: 'Kiro',
  'github-copilot': 'GitHub Copilot',
  codex: 'Codex',
  'gemini-cli': 'Gemini CLI',
  codebuddy: 'CodeBuddy',
  'codebuddy-cn': 'CodeBuddy CN',
  qoder: 'Qoder',
  trae: 'Trae',
  zed: 'Zed',
};

const SAMPLE_SKILLS = [
  {
    id: 'imagegen',
    name: 'Image Forge',
    description: 'Generate production-ready image assets for agents.',
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
    installed_at: 1760000000,
    updated_at: 1760100000,
    ssot_path: '/Users/demo/.haoxiaoguan/skills/imagegen',
    storage_location: 'haoxiaoguan',
  },
  {
    id: 'browser',
    name: 'Browser Runner',
    description: 'Automate browser checks, screenshots, and remote workflows.',
    directory: 'browser',
    repo_owner: 'vercel',
    repo_name: 'agent-browser',
    repo_branch: 'main',
    readme_url: 'https://github.com/vercel/agent-browser/tree/main/skills/browser',
    apps: {
      claude: false,
      codex: true,
      gemini: false,
      opencode: false,
      hermes: true,
    },
    installed_at: 1760000000,
    updated_at: 1760100000,
    ssot_path: '/Users/demo/.haoxiaoguan/skills/browser',
    storage_location: 'haoxiaoguan',
  },
  {
    id: 'tdd',
    name: 'TDD Workflow',
    description: 'Guide agents through red-green-refactor implementation.',
    directory: 'test-driven-development',
    repo_owner: 'superpowers',
    repo_name: 'skills',
    repo_branch: 'main',
    apps: {
      claude: true,
      codex: true,
      gemini: false,
      opencode: false,
      hermes: false,
    },
    installed_at: 1760000000,
    updated_at: 1760100000,
    ssot_path: '/Users/demo/.haoxiaoguan/skills/test-driven-development',
    storage_location: 'haoxiaoguan',
  },
  {
    id: 'openai-docs',
    name: 'OpenAI Docs',
    description: 'Use current official OpenAI documentation with citations.',
    directory: 'openai-docs',
    repo_owner: 'openai',
    repo_name: 'skills',
    repo_branch: 'main',
    apps: {
      claude: false,
      codex: true,
      gemini: true,
      opencode: false,
      hermes: false,
    },
    installed_at: 1760000000,
    updated_at: 1760100000,
    ssot_path: '/Users/demo/.haoxiaoguan/skills/openai-docs',
    storage_location: 'haoxiaoguan',
  },
  {
    id: 'skill-creator',
    name: 'Skill Creator',
    description: 'Create and improve reusable Codex skills.',
    directory: 'skill-creator',
    repo_owner: 'openai',
    repo_name: 'skills',
    repo_branch: 'main',
    apps: {
      claude: true,
      codex: true,
      gemini: false,
      opencode: true,
      hermes: false,
    },
    installed_at: 1760000000,
    updated_at: 1760100000,
    ssot_path: '/Users/demo/.haoxiaoguan/skills/skill-creator',
    storage_location: 'haoxiaoguan',
  },
  {
    id: 'xlsx',
    name: 'Spreadsheet Tools',
    description: 'Read, clean, edit, and export spreadsheet files.',
    directory: 'xlsx',
    repo_owner: 'agents',
    repo_name: 'office-skills',
    repo_branch: 'main',
    apps: {
      claude: false,
      codex: true,
      gemini: false,
      opencode: false,
      hermes: true,
    },
    installed_at: 1760000000,
    updated_at: 1760100000,
    ssot_path: '/Users/demo/.haoxiaoguan/skills/xlsx',
    storage_location: 'haoxiaoguan',
  },
  {
    id: 'pptx',
    name: 'Presentation Tools',
    description: 'Create, read, and update presentation decks.',
    directory: 'pptx',
    repo_owner: 'agents',
    repo_name: 'office-skills',
    repo_branch: 'main',
    apps: {
      claude: true,
      codex: false,
      gemini: true,
      opencode: false,
      hermes: false,
    },
    installed_at: 1760000000,
    updated_at: 1760100000,
    ssot_path: '/Users/demo/.haoxiaoguan/skills/pptx',
    storage_location: 'haoxiaoguan',
  },
  {
    id: 'browser-automation',
    name: 'Browser Automation',
    description: 'Control web pages with CDP scripts and screenshots.',
    directory: 'browser-automation',
    repo_owner: 'agents',
    repo_name: 'browser-automation',
    repo_branch: 'main',
    apps: {
      claude: false,
      codex: true,
      gemini: false,
      opencode: true,
      hermes: false,
    },
    installed_at: 1760000000,
    updated_at: 1760100000,
    ssot_path: '/Users/demo/.haoxiaoguan/skills/browser-automation',
    storage_location: 'haoxiaoguan',
  },
  {
    id: 'electron-testing',
    name: 'Electron Testing',
    description: 'Run end-to-end checks against Electron desktop apps.',
    directory: 'electron-testing',
    repo_owner: 'agents',
    repo_name: 'electron-testing',
    repo_branch: 'main',
    apps: {
      claude: true,
      codex: true,
      gemini: false,
      opencode: false,
      hermes: true,
    },
    installed_at: 1760000000,
    updated_at: 1760100000,
    ssot_path: '/Users/demo/.haoxiaoguan/skills/electron-testing',
    storage_location: 'haoxiaoguan',
  },
  {
    id: 'plugin-creator',
    name: 'Plugin Creator',
    description: 'Scaffold Codex plugins with manifests and marketplace metadata.',
    directory: 'plugin-creator',
    repo_owner: 'openai',
    repo_name: 'skills',
    repo_branch: 'main',
    apps: {
      claude: false,
      codex: true,
      gemini: false,
      opencode: false,
      hermes: false,
    },
    installed_at: 1760000000,
    updated_at: 1760100000,
    ssot_path: '/Users/demo/.haoxiaoguan/skills/plugin-creator',
    storage_location: 'haoxiaoguan',
  },
  {
    id: 'code-review',
    name: 'Code Review',
    description: 'Review changes with bug-first engineering feedback.',
    directory: 'code-review',
    repo_owner: 'openai',
    repo_name: 'skills',
    repo_branch: 'main',
    apps: {
      claude: true,
      codex: true,
      gemini: true,
      opencode: false,
      hermes: false,
    },
    installed_at: 1760000000,
    updated_at: 1760100000,
    ssot_path: '/Users/demo/.haoxiaoguan/skills/code-review',
    storage_location: 'haoxiaoguan',
  },
  {
    id: 'local-runbook',
    name: 'Local Runbook',
    description: 'Team-local operational checklist for release work.',
    directory: 'local-runbook',
    apps: {
      claude: false,
      codex: true,
      gemini: false,
      opencode: false,
      hermes: false,
    },
    installed_at: 1760000000,
    updated_at: 1760100000,
    ssot_path: '/Users/demo/.haoxiaoguan/skills/local-runbook',
    storage_location: 'haoxiaoguan',
  },
];

const SAMPLE_DISCOVERABLE_SKILLS = [
  {
    name: 'Code Review',
    description: 'Review pull requests with bug-first engineering feedback.',
    directory: 'code-review',
    repo_owner: 'openai',
    repo_name: 'skills',
    repo_branch: 'main',
    readme_url: 'https://github.com/openai/skills/tree/main/code-review',
    metadata: { tags: ['review'] },
  },
];

const SAMPLE_MCP_SERVERS: McpServer[] = [
  {
    id: 'mcp-filesystem',
    name: 'filesystem',
    description: '本地文件系统读写访问',
    spec: {
      transport: 'stdio' as const,
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      env: {},
    },
    apps: { claude: true, codex: true, gemini: false, opencode: false, hermes: false },
    tags: ['文件系统', '官方'],
    created_at: Math.floor(Date.now() / 1000) - 86400,
    updated_at: Math.floor(Date.now() / 1000) - 3600,
    sort_order: 0,
  },
  {
    id: 'mcp-github',
    name: 'github',
    description: 'GitHub 仓库、Issue、PR 操作',
    spec: {
      transport: 'stdio' as const,
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: {},
    },
    apps: { claude: true, codex: false, gemini: true, opencode: false, hermes: false },
    tags: ['github'],
    created_at: Math.floor(Date.now() / 1000) - 172800,
    updated_at: Math.floor(Date.now() / 1000) - 7200,
    sort_order: 1,
  },
  {
    id: 'mcp-remote-api',
    name: 'remote-api',
    description: '远程 HTTP MCP 服务示例',
    spec: {
      transport: 'http' as const,
      url: 'http://localhost:3000/mcp',
    },
    apps: { claude: false, codex: false, gemini: false, opencode: true, hermes: true },
    tags: [],
    created_at: Math.floor(Date.now() / 1000) - 259200,
    updated_at: Math.floor(Date.now() / 1000) - 10800,
    sort_order: 2,
  },
];

/** 安装开发期 mock invoke 到 window.__TAURI_INTERNALS__，必须在 React 挂载前执行。 */
export function installAccountsMock(): void {
  if (typeof window === 'undefined') return;
  const mockMode = new URLSearchParams(window.location.search).get('mock');
  if (!mockMode) return;
  const sampleAccounts = mockMode === 'empty' ? [] : SAMPLE_ACCOUNTS;
  let sampleSkills = mockMode === 'empty' ? [] : SAMPLE_SKILLS.map((skill) => ({
    ...skill,
    apps: { ...skill.apps },
  }));
  let sampleMcpServers = mockMode === 'empty'
    ? []
    : SAMPLE_MCP_SERVERS.map((server) => ({ ...server, apps: { ...server.apps } }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, args?: Record<string, unknown>) => {
      const a = (args ?? {}) as Record<string, unknown>;
      switch (cmd) {
        case 'get_accounts_by_platform':
          return sampleAccounts.filter((acc) => acc.platform === a.platform);
        case 'get_platforms':
          return Object.entries(PLATFORM_NAMES).map(([id, displayName]) => ({
            id,
            displayName,
            family: 'standalone',
            capabilities: {
              family: 'standalone',
              supportsMultiInstance: false,
              supportsAutoLaunch: false,
              supportsExtensionInjection: false,
              supportedImportMethods: ['oauth'],
              customActions: [],
            },
          }));
        case 'get_installed_skills':
          return sampleSkills;
        case 'get_app_dirs':
          return {
            dataDir: '/Users/demo/Library/Application Support/com.haoxiaoguan.app',
            configDir: '/Users/demo/Library/Application Support/com.haoxiaoguan.app/config',
            logDir: '/Users/demo/Library/Logs/haoxiaoguan',
          };
        case 'discover_available_skills':
          return SAMPLE_DISCOVERABLE_SKILLS;
        case 'toggle_skill_app': {
          const request = a.request as { skill_id: string; agent_id: string; enabled: boolean };
          sampleSkills = sampleSkills.map((skill) =>
            skill.id === request.skill_id
              ? { ...skill, apps: { ...skill.apps, [request.agent_id]: request.enabled } }
              : skill,
          );
          return true;
        }
        case 'uninstall_skill_unified':
          sampleSkills = sampleSkills.filter((skill) => skill.id !== a.skillId);
          return true;
        case 'check_skill_updates':
          return { has_update: a.skillId === 'imagegen' || a.skillId === 'browser' };
        case 'update_skill':
          return sampleSkills.find((skill) => skill.id === a.skillId) ?? sampleSkills[0];
        case 'open_zip_file_dialog':
          return null;
        case 'install_skills_from_zip':
          return [];
        case 'get_skill_backups':
          return [
            {
              backup_id: 'backup-imagegen-001',
              skill_id: 'imagegen',
              snapshot_json: JSON.stringify({
                name: 'Image Forge',
                description: '生成 UI mockup、插画、素材预览。',
                directory: 'imagegen',
              }),
              archive_path: '/Users/demo/.haoxiaoguan/backups/imagegen-2026-05-25.zip',
              created_at: Math.floor(Date.now() / 1000) - 3600,
            },
            {
              backup_id: 'backup-browser-001',
              skill_id: 'browser',
              snapshot_json: JSON.stringify({
                name: 'Browser Runner',
                description: 'Automate browser checks, screenshots and remote workflows.',
                directory: 'browser',
              }),
              archive_path: '/Users/demo/.haoxiaoguan/backups/browser-2026-05-23.zip',
              created_at: Math.floor(Date.now() / 1000) - 86400,
            },
          ];
        case 'delete_skill_backup':
          return null;
        case 'restore_skill_backup':
          return sampleSkills[0] ?? null;
        case 'scan_unmanaged_skills': {
          const agentId = String(a.agentId ?? '');
          const dirsByAgent: Record<string, Array<{ dir_name: string; path: string }>> = {
            claude: [
              { dir_name: 'pdf-toolbox', path: '/Users/demo/.claude/skills/pdf-toolbox' },
              { dir_name: 'release-runner', path: '/Users/demo/.claude/skills/release-runner' },
            ],
            codex: [
              { dir_name: 'shell-helpers', path: '/Users/demo/.codex/skills/shell-helpers' },
            ],
            gemini: [],
            opencode: [
              { dir_name: 'docgen', path: '/Users/demo/.config/opencode/skills/docgen' },
            ],
            hermes: [],
          };
          return dirsByAgent[agentId] ?? [];
        }
        case 'import_skills_from_apps': {
          const request = a.request as { agent_id: string; dir_names: string[] };
          const imported = (request?.dir_names ?? []).map((dir) => ({
            id: `imported-${dir}`,
            name: dir,
            description: `从 ${request.agent_id} 导入的 ${dir}`,
            directory: dir,
            apps: { claude: false, codex: false, gemini: false, opencode: false, hermes: false, [request.agent_id]: true },
            installed_at: Date.now(),
            updated_at: Date.now(),
            ssot_path: `/Users/demo/.haoxiaoguan/skills/${dir}`,
            storage_location: 'haoxiaoguan',
          }));
          sampleSkills = [...sampleSkills, ...imported];
          return imported;
        }
        case 'get_mcp_servers':
          return sampleMcpServers;
        case 'upsert_mcp_server': {
          const request = a.request as {
            id?: string;
            name: string;
            description?: string;
            transport: string;
            command?: string;
            args?: string[];
            url?: string;
            env?: Record<string, string>;
            apps?: Record<string, boolean>;
            tags?: string[];
          };
          const now = Math.floor(Date.now() / 1000);
          const spec = {
            transport: request.transport as 'stdio' | 'http' | 'sse',
            command: request.command,
            args: request.args,
            url: request.url,
            env: request.env,
          };
          const existing = request.id
            ? sampleMcpServers.find((server) => server.id === request.id)
            : sampleMcpServers.find((server) => server.name === request.name);
          if (existing) {
            existing.name = request.name;
            existing.description = request.description;
            existing.spec = spec;
            existing.tags = request.tags ?? existing.tags;
            existing.updated_at = now;
          } else {
            sampleMcpServers = [
              ...sampleMcpServers,
              {
                id: `mcp-${request.name}-${now}`,
                name: request.name,
                description: request.description,
                spec,
                apps: request.apps ?? {
                  claude: false,
                  codex: false,
                  gemini: false,
                  opencode: false,
                  hermes: false,
                },
                tags: request.tags ?? [],
                created_at: now,
                updated_at: now,
                sort_order: sampleMcpServers.length,
              },
            ];
          }
          return null;
        }
        case 'delete_mcp_server':
          sampleMcpServers = sampleMcpServers.filter((server) => server.id !== a.serverId);
          return null;
        case 'toggle_mcp_app': {
          const request = a.request as { server_id: string; agent_id: string; enabled: boolean };
          sampleMcpServers = sampleMcpServers.map((server) =>
            server.id === request.server_id
              ? { ...server, apps: { ...server.apps, [request.agent_id]: request.enabled } }
              : server,
          );
          return true;
        }
        case 'import_mcp_from_apps':
          return { imported_count: 2 };
        case 'scan_unmanaged_mcp': {
          // 返回一批“未纳入管理”的示例 MCP，附带它们出现在哪些 agent 配置里
          const managedIds = new Set(sampleMcpServers.map((server) => server.id));
          return [
            {
              id: 'node-repl',
              name: 'node-repl',
              spec: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-node-repl'] },
              found_in: ['codex', 'claude'],
            },
            {
              id: 'pencil',
              name: 'pencil',
              spec: { transport: 'stdio', command: 'pencil-mcp', args: [] },
              found_in: ['codex'],
            },
            {
              id: 'context7',
              name: 'context7',
              spec: { transport: 'http', url: 'https://mcp.context7.com/mcp' },
              found_in: ['gemini', 'opencode'],
            },
          ].filter((entry) => !managedIds.has(entry.id));
        }
        case 'import_selected_mcp': {
          const request = a.request as {
            selections: Array<{ server_id: string; agent_ids: string[] }>;
          };
          return { imported_count: request.selections?.length ?? 0 };
        }
        case 'validate_mcp_command':
          return { valid: true };
        case 'sessions:repairPreview':
          return { available: false, counts: [], repairable: 0, codexRunning: false };
        case 'sessions:repair':
          return { updatedThreads: 0, modelRows: 0, userEventRows: 0, cwdRows: 0, globalStateKeys: 0, changedRollouts: 0, skippedRollouts: 0, backupId: 'mock' };
        case 'sessions:repairRollback':
          return undefined;
        case 'validate_batch':
          return ((a.accountIds as string[]) ?? []).map((id) => ({
            account_id: id,
            result: {
              state:
                id === 'wind-back'
                  ? 'expired'
                  : id === 'codex-api'
                    ? 'pending'
                    : id === 'qoder-beta'
                      ? 'revoked'
                      : 'valid',
              checked_at: new Date().toISOString(),
            },
          }));
        case 'get_account_health':
          return {
            account_id: a.accountId,
            validation: { state: 'valid', checked_at: new Date().toISOString() },
            quota: {
              outcome: 'success',
              source: 'live',
              freshness: 'fresh',
              fetched_at: new Date().toISOString(),
              models: [
                { model_name: 'sonnet-4.5', used: 320, total: 500 },
                { model_name: 'opus-4', used: 80, total: 100 },
              ],
            },
            checked_at: new Date().toISOString(),
          };
        case 'get_quota_state':
        case 'refresh_quota_state': {
          const accountId = String(a.accountId);
          const account = sampleAccounts.find((item) => item.id === accountId);
          return quotaStateForAccount(account);
        }
        default:
          return null;
      }
    },
  };

  console.info('[mock-invoke] dev mock installed');
}

function quotaStateForAccount(account?: (typeof SAMPLE_ACCOUNTS)[number]) {
  const fetchedAt = new Date().toISOString();
  switch (account?.platform) {
    case 'cursor':
      return {
        version: 1,
        status: 'ok',
        primaryMetricKey: 'total_usage',
        metrics: [
          {
            key: 'total_usage',
            label: 'Total Usage',
            kind: 'usage',
            unit: 'usd',
            used: 8,
            total: 20,
            remaining: 12,
            percentUsed: 40,
            percentRemaining: 60,
            displayValue: '40%',
            status: 'ok',
          },
          {
            key: 'auto_composer',
            label: 'Auto + Composer',
            kind: 'usage',
            unit: 'percent',
            percentUsed: 51,
            percentRemaining: 49,
            displayValue: '51%',
            status: 'ok',
          },
          {
            key: 'api_usage',
            label: 'API Usage',
            kind: 'usage',
            unit: 'percent',
            percentUsed: 1,
            percentRemaining: 99,
            displayValue: '1%',
            status: 'ok',
          },
        ],
        fetchedAt,
        providerPayload: account.profilePayload,
      };
    case 'gemini-cli':
      return {
        version: 1,
        status: 'exhausted',
        primaryMetricKey: 'pro',
        metrics: [
          {
            key: 'pro',
            label: 'Pro',
            kind: 'remaining',
            unit: 'percent',
            percentUsed: 100,
            percentRemaining: 0,
            displayValue: '0% 剩余',
            status: 'exhausted',
          },
          {
            key: 'flash',
            label: 'Flash',
            kind: 'remaining',
            unit: 'percent',
            percentUsed: 0,
            percentRemaining: 100,
            displayValue: '100% 剩余',
            status: 'ok',
          },
        ],
        fetchedAt,
        providerPayload: account.profilePayload,
      };
    case 'kiro':
      return {
        version: 1,
        status: 'ok',
        primaryMetricKey: 'credits',
        metrics: [
          {
            key: 'credits',
            label: 'Credits',
            kind: 'usage',
            unit: 'credits',
            used: 25,
            total: 100,
            remaining: 75,
            percentUsed: 25,
            percentRemaining: 75,
            displayValue: '25 / 100',
            status: 'ok',
          },
        ],
        fetchedAt,
        providerPayload: account.profilePayload,
      };
    case 'github-copilot':
      return entitlementQuotaState('Copilot', account.planName ?? 'Team', account.profilePayload, fetchedAt);
    case 'codex':
      {
        const hourlyResetAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
        const weeklyResetAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
        return {
          version: 1,
          status: 'ok',
          primaryMetricKey: 'codex_hourly',
          metrics: [
            {
              key: 'codex_hourly',
              label: '5小时额度',
              kind: 'remaining',
              unit: 'percent',
              percentUsed: 65,
              percentRemaining: 35,
              displayValue: '35% 剩余',
              window: 'hour',
              resetAt: hourlyResetAt,
              status: 'ok',
            },
            {
              key: 'codex_weekly',
              label: '周额度',
              kind: 'remaining',
              unit: 'percent',
              percentUsed: 20,
              percentRemaining: 80,
              displayValue: '80% 剩余',
              window: 'billing_cycle',
              resetAt: weeklyResetAt,
              status: 'ok',
            },
          ],
          fetchedAt,
          providerPayload: {
            ...account.profilePayload,
            quota: {
              hourly_percentage: 35,
              hourly_reset_time: Math.floor(new Date(hourlyResetAt).getTime() / 1000),
              hourly_window_minutes: 300,
              hourly_window_present: true,
              weekly_percentage: 80,
              weekly_reset_time: Math.floor(new Date(weeklyResetAt).getTime() / 1000),
              weekly_window_minutes: 10080,
              weekly_window_present: true,
            },
          },
        };
      }
    default:
      return genericQuotaState(account, fetchedAt);
  }
}

function entitlementQuotaState(label: string, value: string, providerPayload: unknown, fetchedAt: string) {
  return {
    version: 1,
    status: 'ok',
    primaryMetricKey: 'entitlement',
    metrics: [
      {
        key: 'entitlement',
        label,
        kind: 'entitlement',
        unit: 'none',
        percentUsed: 100,
        displayValue: value,
        status: 'ok',
      },
    ],
    fetchedAt,
    providerPayload,
  };
}

function genericQuotaState(account: (typeof SAMPLE_ACCOUNTS)[number] | undefined, fetchedAt: string) {
  const usage = account?.profilePayload && 'usage' in account.profilePayload
    ? account.profilePayload.usage as { used?: number; total?: number; unit?: string }
    : undefined;
  if (!usage?.total) {
    return entitlementQuotaState('凭据状态', account?.status ?? '等待同步', account?.profilePayload ?? {}, fetchedAt);
  }
  const used = usage.used ?? 0;
  const percentUsed = Math.round((used * 100) / usage.total);
  return {
    version: 1,
    status: account?.status === 'expired' ? 'warning' : 'ok',
    primaryMetricKey: 'usage',
    metrics: [
      {
        key: 'usage',
        label: 'Usage',
        kind: 'usage',
        unit: usage.unit ?? 'requests',
        used,
        total: usage.total,
        remaining: Math.max(usage.total - used, 0),
        percentUsed,
        percentRemaining: Math.max(100 - percentUsed, 0),
        displayValue: `${used} / ${usage.total}`,
        status: account?.status === 'expired' ? 'warning' : 'ok',
      },
    ],
    fetchedAt,
    providerPayload: account?.profilePayload ?? {},
  };
}
