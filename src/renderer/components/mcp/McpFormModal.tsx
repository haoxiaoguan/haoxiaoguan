import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { JsonEditor } from '@/components/ui/json-editor';
import { cn } from '@/lib/utils';
import type {
  McpServer,
  McpServerSpec,
  McpTransport,
  UpsertMcpServerRequest,
} from '../../types';
import { useMcpStore } from '../../stores/mcpStore';
import { AgentLogo, SKILL_AGENTS, type SkillAgentId } from '../skills/AgentLogo';

interface McpFormModalProps {
  server: McpServer | null;
  existingIds?: string[];
  onClose: () => void;
}

const JSON_PLACEHOLDER = `{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
}

// 或 HTTP / SSE：
// {
//   "type": "http",
//   "url": "http://localhost:3000/mcp"
// }`;

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="mb-1.5 block text-[13px] font-medium text-foreground">
      {children}
      {required ? <span className="ml-0.5 text-destructive">*</span> : null}
    </label>
  );
}

/** 把已有 server 的 spec 转成编辑器初始 JSON 文本（单服务结构）。 */
function specToJsonText(spec: McpServerSpec | undefined): string {
  if (!spec) return '';
  const obj: Record<string, unknown> = { type: spec.transport };
  if (spec.command) obj.command = spec.command;
  if (spec.args?.length) obj.args = spec.args;
  if (spec.env && Object.keys(spec.env).length) obj.env = spec.env;
  if (spec.url) obj.url = spec.url;
  return JSON.stringify(obj, null, 2);
}

export function McpFormModal({ server, existingIds = [], onClose }: McpFormModalProps) {
  const { t } = useTranslation();
  const { upsertServer } = useMcpStore();

  const isEditing = Boolean(server);

  const [id, setId] = useState(server?.id ?? '');
  const [name, setName] = useState(server?.name ?? '');
  const [appsState, setAppsState] = useState<Record<SkillAgentId, boolean>>(() => {
    const base = SKILL_AGENTS.reduce<Record<SkillAgentId, boolean>>(
      (acc, agent) => ({ ...acc, [agent.id]: false }),
      {} as Record<SkillAgentId, boolean>,
    );
    if (server?.apps) {
      for (const agent of SKILL_AGENTS) {
        base[agent.id] = Boolean(server.apps[agent.id]);
      }
    } else {
      // 新增默认勾选 claude/codex/gemini
      base.claude = true;
      base.codex = true;
      base.gemini = true;
    }
    return base;
  });

  const [jsonText, setJsonText] = useState(() => specToJsonText(server?.spec));
  const [jsonErrorCount, setJsonErrorCount] = useState(0);

  const hasMetadata = Boolean(
    server?.description || server?.tags?.length || server?.homepage || server?.docs,
  );
  const [showMetadata, setShowMetadata] = useState(hasMetadata);
  const [description, setDescription] = useState(server?.description ?? '');
  const [tags, setTags] = useState(server?.tags.join(', ') ?? '');
  const [homepage, setHomepage] = useState(server?.homepage ?? '');
  const [docs, setDocs] = useState(server?.docs ?? '');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idError = useMemo(() => {
    if (isEditing) return '';
    const trimmed = id.trim();
    if (trimmed && existingIds.includes(trimmed)) {
      return t('mcp.error.idExists', '该 ID 已存在');
    }
    return '';
  }, [id, isEditing, existingIds, t]);

  const canSubmit =
    id.trim().length > 0 && jsonText.trim().length > 0 && jsonErrorCount === 0 && !idError;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const spec = parseSpecJson(jsonText);
      // spec 必填校验
      if (spec.transport === 'stdio' && !spec.command?.trim()) {
        throw new Error(t('mcp.error.commandRequired', 'stdio 传输需要填写 command'));
      }
      if (spec.transport !== 'stdio' && !spec.url?.trim()) {
        throw new Error(t('mcp.error.urlRequired', 'HTTP/SSE 传输需要填写 url'));
      }

      const trimmedId = id.trim();
      const request: UpsertMcpServerRequest = {
        id: trimmedId,
        name: name.trim() || trimmedId,
        transport: spec.transport,
        command: spec.command,
        args: spec.args,
        env: spec.env,
        url: spec.url,
        apps: appsState,
        description: showMetadata && description.trim() ? description.trim() : undefined,
        homepage: showMetadata && homepage.trim() ? homepage.trim() : undefined,
        docs: showMetadata && docs.trim() ? docs.trim() : undefined,
        tags:
          showMetadata && tags.trim()
            ? tags
                .split(',')
                .map((tag) => tag.trim())
                .filter(Boolean)
            : undefined,
      };
      await upsertServer(request);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="flex max-h-[88vh] max-w-2xl flex-col gap-3 p-5">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t('mcp.editServer', '编辑服务') : t('mcp.addServer', '添加服务')}
          </DialogTitle>
          <DialogDescription>
            {t('mcp.form.desc', '用 JSON 配置 MCP 服务，附加信息可选填，保存后可在列表同步到各 Agent。')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel required>{t('mcp.form.title', 'ID')}</FieldLabel>
              <Input
                value={id}
                onChange={(e) => setId(e.target.value)}
                required
                disabled={isEditing}
                placeholder="filesystem"
                className={cn('h-9 rounded-[8px] font-mono text-[12px]', isEditing && 'opacity-60')}
              />
              {idError ? (
                <p className="mt-1 text-[12px] font-medium text-destructive">{idError}</p>
              ) : null}
            </div>
            <div>
              <FieldLabel>{t('mcp.form.name', '名称')}</FieldLabel>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('mcp.form.namePlaceholder', '展示名称（可选，默认用 ID）')}
                className="h-9 rounded-[8px]"
              />
            </div>
          </div>

          <div>
            <FieldLabel>{t('mcp.form.enabledApps', '启用到以下 Agent')}</FieldLabel>
            <div className="flex flex-wrap items-center gap-1.5">
              {SKILL_AGENTS.map((agent) => {
                const enabled = appsState[agent.id];
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() =>
                      setAppsState((prev) => ({ ...prev, [agent.id]: !prev[agent.id] }))
                    }
                    aria-pressed={enabled}
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-[7px] border px-2.5 text-[12px] transition-colors',
                      enabled
                        ? 'border-primary/30 bg-primary/8 text-primary'
                        : 'border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                    )}
                  >
                    <AgentLogo
                      agentId={agent.id}
                      className="size-4 rounded-[4px] border-0 bg-transparent shadow-none"
                      imageClassName="size-3.5"
                    />
                    <span>{agent.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <FieldLabel required>{t('mcp.form.jsonConfig', 'MCP 配置 JSON')}</FieldLabel>
            <JsonEditor
              value={jsonText}
              onChange={setJsonText}
              onValidate={setJsonErrorCount}
              height={220}
              ariaLabel={t('mcp.form.jsonConfig', 'MCP 配置 JSON')}
              placeholder={JSON_PLACEHOLDER}
            />
            <p className="mt-1.5 text-[11.5px] text-muted-foreground">
              {t(
                'mcp.form.jsonHint',
                '填写单个服务的配置；transport 按 type / command / url 自动推断。',
              )}
            </p>
            {jsonErrorCount > 0 ? (
              <p className="mt-1 flex items-center gap-1 text-[12px] font-medium text-destructive">
                <AlertCircle className="size-3.5" aria-hidden />
                {t('mcp.form.jsonInvalid', `JSON 存在 ${jsonErrorCount} 处语法错误`, {
                  count: jsonErrorCount,
                })}
              </p>
            ) : null}
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowMetadata((prev) => !prev)}
              className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {showMetadata ? (
                <ChevronUp className="size-4" aria-hidden />
              ) : (
                <ChevronDown className="size-4" aria-hidden />
              )}
              {t('mcp.form.additionalInfo', '附加信息')}
            </button>
          </div>

          {showMetadata ? (
            <div className="space-y-3.5">
              <div>
                <FieldLabel>{t('mcp.form.description', '描述')}</FieldLabel>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('mcp.form.descriptionPlaceholder', '简单说明这个服务的用途')}
                  className="h-9 rounded-[8px]"
                />
              </div>
              <div>
                <FieldLabel>{t('mcp.form.tags', '标签（逗号分隔）')}</FieldLabel>
                <Input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder={t('mcp.form.tagsPlaceholder', '工具, 文件系统')}
                  className="h-9 rounded-[8px]"
                />
              </div>
              <div>
                <FieldLabel>{t('mcp.form.homepage', '主页')}</FieldLabel>
                <Input
                  value={homepage}
                  onChange={(e) => setHomepage(e.target.value)}
                  placeholder="https://example.com"
                  className="h-9 rounded-[8px] font-mono text-[12px]"
                />
              </div>
              <div>
                <FieldLabel>{t('mcp.form.docs', '文档')}</FieldLabel>
                <Input
                  value={docs}
                  onChange={(e) => setDocs(e.target.value)}
                  placeholder="https://example.com/docs"
                  className="h-9 rounded-[8px] font-mono text-[12px]"
                />
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="flex items-center gap-1.5 text-sm text-destructive">
              <AlertCircle className="size-4 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          ) : null}
        </form>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {t('common.cancel', '取消')}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={submitting || !canSubmit}>
            {submitting ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {submitting
              ? t('common.saving', '保存中...')
              : isEditing
                ? t('common.save', '保存')
                : t('common.add', '添加')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 解析单服务 spec JSON，返回 transport/command/args/env/url。
 *
 * transport 推断：显式 type/transport 优先；否则有 url → http，有 command → stdio。
 */
function parseSpecJson(raw: string): {
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('JSON 解析失败，请检查格式是否正确。');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON 顶层必须是一个对象。');
  }

  const spec = parsed as Record<string, unknown>;
  const explicit = (spec.type ?? spec.transport) as string | undefined;
  const url = typeof spec.url === 'string' ? spec.url : undefined;
  const command = typeof spec.command === 'string' ? spec.command : undefined;

  let transport: McpTransport;
  if (explicit === 'sse') transport = 'sse';
  else if (explicit === 'http' || explicit === 'streamable-http') transport = 'http';
  else if (explicit === 'stdio') transport = 'stdio';
  else if (url) transport = 'http';
  else transport = 'stdio';

  const args = Array.isArray(spec.args) ? spec.args.map((arg) => String(arg)) : undefined;
  const env =
    spec.env && typeof spec.env === 'object' && !Array.isArray(spec.env)
      ? Object.fromEntries(
          Object.entries(spec.env as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
        )
      : undefined;

  return {
    transport,
    command: transport === 'stdio' ? command : undefined,
    args: transport === 'stdio' ? args : undefined,
    env,
    url: transport !== 'stdio' ? url : undefined,
  };
}
