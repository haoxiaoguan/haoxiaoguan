import { describe, it, expect } from 'vitest'
import {
  planUpgradeCommand,
  staticUpgradeFallback,
  brewFormulaFromPath,
  type UpgradeTarget,
} from '../../../src/main/contexts/clientConfig/infrastructure/cli-upgrade-planner'
import { INSTALL_COMMAND } from '../../../src/main/contexts/clientConfig/domain/client-version'

const target = (p: Partial<UpgradeTarget>): UpgradeTarget => ({
  path: '/Users/me/.nvm/versions/node/v22.0.0/bin/claude',
  real: '/Users/me/.nvm/versions/node/v22.0.0/lib/node_modules/@anthropic-ai/claude-code/cli.js',
  source: 'nvm',
  runnable: true,
  ...p,
})

describe('planUpgradeCommand（锚定升级，对称移植 cc-switch anchored_command_from_paths）', () => {
  it('claude on bun（用户报的场景）→ 纯 bun 锚定，不走 `claude update`（npm 安装 self-update 非TTY假成功）', () => {
    const { command, anchored } = planUpgradeCommand(
      'claude',
      target({
        path: '/Users/liuqin/.bun/bin/claude',
        real: '/Users/liuqin/.bun/install/global/node_modules/@anthropic-ai/claude-code/cli.js',
        source: 'bun',
      }),
    )
    expect(anchored).toBe(true)
    expect(command).toBe('/Users/liuqin/.bun/bin/bun add -g @anthropic-ai/claude-code@latest')
    expect(command).not.toContain('claude update')
  })

  it('claude on nvm → 纯 `<同目录 npm> i -g`（不走 `claude update`）', () => {
    const { command } = planUpgradeCommand('claude', target({ source: 'nvm' }))
    expect(command).toBe(
      '/Users/me/.nvm/versions/node/v22.0.0/bin/npm i -g --prefix /Users/me/.nvm/versions/node/v22.0.0 @anthropic-ai/claude-code@latest',
    )
    expect(command).not.toContain('claude update')
  })

  it('claude on mise → 同目录 npm + --prefix 锚到该 Node 安装，避免用户 npm prefix 写去别处', () => {
    const { command } = planUpgradeCommand(
      'claude',
      target({
        path: '/Users/me/.local/share/mise/installs/node/22.15.1/bin/claude',
        real: '/Users/me/.local/share/mise/installs/node/22.15.1/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe',
        source: 'mise',
      }),
    )
    expect(command).toBe(
      '/Users/me/.local/share/mise/installs/node/22.15.1/bin/npm i -g --prefix /Users/me/.local/share/mise/installs/node/22.15.1 @anthropic-ai/claude-code@latest',
    )
  })

  it('claude on mise shim → 从真身 Node 安装推导 npm prefix，不能写进 shims 目录', () => {
    const { command } = planUpgradeCommand(
      'claude',
      target({
        path: '/Users/me/.local/share/mise/shims/claude',
        real: '/Users/me/.local/share/mise/installs/node/22.15.1/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe',
        source: 'mise',
      }),
    )
    expect(command).toBe(
      '/Users/me/.local/share/mise/installs/node/22.15.1/bin/npm i -g --prefix /Users/me/.local/share/mise/installs/node/22.15.1 @anthropic-ai/claude-code@latest',
    )
  })

  it('claude on unresolved mise shim → 不从 shim 路径推导 npm prefix', () => {
    const { command, anchored } = planUpgradeCommand(
      'claude',
      target({
        path: '/Users/me/.local/share/mise/shims/claude',
        real: '/Users/me/.local/share/mise/shims/claude',
        source: 'mise',
      }),
    )
    expect(anchored).toBe(false)
    expect(command).toBe('npm i -g @anthropic-ai/claude-code@latest')
    expect(command).not.toContain('/mise/shims/npm')
    expect(command).not.toContain('--prefix /Users/me/.local/share/mise')
  })

  it('codex on fnm multishell shim → 从真身 Node 安装推导 npm prefix', () => {
    const { command } = planUpgradeCommand(
      'codex',
      target({
        path: '/var/folders/xx/fnm_multishells/123/bin/codex',
        real: '/Users/me/.local/share/fnm/node-versions/v22.0.0/installation/lib/node_modules/@openai/codex/bin/codex.js',
        source: 'fnm',
      }),
    )
    expect(command).toBe(
      '/Users/me/.local/share/fnm/node-versions/v22.0.0/installation/bin/npm i -g --prefix /Users/me/.local/share/fnm/node-versions/v22.0.0/installation @openai/codex@latest',
    )
  })

  it('claude 原生安装器（真身在 ~/.local/share/claude/）→ 仅 `<bin> update`，不接 npm', () => {
    const { command, anchored } = planUpgradeCommand(
      'claude',
      target({
        path: '/Users/me/.local/bin/claude',
        real: '/Users/me/.local/share/claude/versions/2.1.0/claude',
        source: 'unknown',
      }),
    )
    expect(anchored).toBe(true)
    expect(command).toBe('/Users/me/.local/bin/claude update')
  })

  it('gemini_cli（无官方自升级）on nvm → 纯 `<同目录 npm> i -g`', () => {
    const { command } = planUpgradeCommand(
      'gemini_cli',
      target({ path: '/Users/me/.nvm/versions/node/v22.0.0/bin/gemini' }),
    )
    expect(command).toBe(
      '/Users/me/.nvm/versions/node/v22.0.0/bin/npm i -g --prefix /Users/me/.nvm/versions/node/v22.0.0 @google/gemini-cli@latest',
    )
  })

  it('codex runnable on nvm → 纯 npm 锚定（刻意不跑 `codex update` 以免假成功）', () => {
    const { command } = planUpgradeCommand(
      'codex',
      target({ path: '/Users/me/.nvm/versions/node/v22.0.0/bin/codex', source: 'nvm' }),
    )
    expect(command).toBe(
      '/Users/me/.nvm/versions/node/v22.0.0/bin/npm i -g --prefix /Users/me/.nvm/versions/node/v22.0.0 @openai/codex@latest',
    )
    expect(command).not.toContain('codex update')
  })

  it('codex 损坏（runnable=false）on nvm → uninstall+install 自愈', () => {
    const { command, anchored } = planUpgradeCommand(
      'codex',
      target({ path: '/Users/me/.nvm/versions/node/v22.0.0/bin/codex', source: 'nvm', runnable: false }),
    )
    expect(anchored).toBe(true)
    expect(command).toBe(
      '/Users/me/.nvm/versions/node/v22.0.0/bin/npm uninstall -g --prefix /Users/me/.nvm/versions/node/v22.0.0 @openai/codex || true; ' +
        '/Users/me/.nvm/versions/node/v22.0.0/bin/npm i -g --prefix /Users/me/.nvm/versions/node/v22.0.0 @openai/codex@latest',
    )
  })

  it('codex 损坏 on bun（不在自愈白名单）→ 退回 bun add 锚定', () => {
    const { command } = planUpgradeCommand(
      'codex',
      target({ path: '/Users/me/.bun/bin/codex', source: 'bun', runnable: false }),
    )
    expect(command).toBe('/Users/me/.bun/bin/bun add -g @openai/codex@latest')
  })

  it('homebrew formula（真身在 Cellar）→ `<同目录 brew> upgrade <formula>`', () => {
    const { command } = planUpgradeCommand(
      'gemini_cli',
      target({
        path: '/opt/homebrew/bin/gemini',
        real: '/opt/homebrew/Cellar/gemini-cli/0.46.0/libexec/bin/gemini',
        source: 'homebrew',
      }),
    )
    expect(command).toBe('/opt/homebrew/bin/brew upgrade gemini-cli')
  })

  it('volta → `<同目录 volta> install <pkg>`', () => {
    const { command } = planUpgradeCommand(
      'codex',
      target({ path: '/Users/me/.volta/bin/codex', source: 'volta' }),
    )
    expect(command).toBe('/Users/me/.volta/bin/volta install @openai/codex')
  })

  it('opencode on bun → `<bin> upgrade || <bun> add -g`', () => {
    const { command } = planUpgradeCommand(
      'opencode',
      target({ path: '/Users/me/.bun/bin/opencode', source: 'bun' }),
    )
    expect(command).toBe('/Users/me/.bun/bin/opencode upgrade || /Users/me/.bun/bin/bun add -g opencode-ai@latest')
  })

  it('openclaw on nvm → `<bin> update --yes || <npm> i -g`', () => {
    const { command } = planUpgradeCommand(
      'openclaw',
      target({ path: '/Users/me/.nvm/versions/node/v22.0.0/bin/openclaw', source: 'nvm' }),
    )
    expect(command).toBe(
      '/Users/me/.nvm/versions/node/v22.0.0/bin/openclaw update --yes || ' +
        '/Users/me/.nvm/versions/node/v22.0.0/bin/npm i -g --prefix /Users/me/.nvm/versions/node/v22.0.0 openclaw@latest',
    )
  })

  it('hermes（PyPI）→ 仅 `<bin> update`', () => {
    const { command } = planUpgradeCommand(
      'hermes',
      target({ path: '/Users/me/Library/Python/3.11/bin/hermes', source: 'pip' }),
    )
    expect(command).toBe('/Users/me/Library/Python/3.11/bin/hermes update')
  })

  it('来源 pip/unknown 的 npm 工具（无可靠 sibling npm）→ 回退静态命令', () => {
    const { command, anchored } = planUpgradeCommand(
      'gemini_cli',
      target({ path: '/usr/local/bin/gemini', source: 'unknown' }),
    )
    expect(anchored).toBe(false)
    expect(command).toBe('npm i -g @google/gemini-cli@latest')
  })

  it('含空格路径 → 单引号包裹', () => {
    const { command } = planUpgradeCommand(
      'gemini_cli',
      target({ path: '/Users/My Name/.nvm/bin/gemini', source: 'nvm' }),
    )
    expect(command).toBe(
      "'/Users/My Name/.nvm/bin/npm' i -g --prefix '/Users/My Name/.nvm' @google/gemini-cli@latest",
    )
  })

  it('target 未定位（undefined）→ 静态兜底（claude 纯 npm，不走 self-update）', () => {
    expect(planUpgradeCommand('claude', undefined)).toEqual({
      command: 'npm i -g @anthropic-ai/claude-code@latest',
      anchored: false,
    })
  })
})

describe('staticUpgradeFallback', () => {
  it('claude → 纯 npm（不走 `claude update`，避免 npm 安装 self-update 非TTY假成功）', () => {
    expect(staticUpgradeFallback('claude')).toBe('npm i -g @anthropic-ai/claude-code@latest')
  })
  it('codex → 裸 npm（不走 `codex update`，避免平台二进制漏装时假成功）', () => {
    expect(staticUpgradeFallback('codex')).toBe('npm i -g @openai/codex@latest')
  })
  it('gemini_cli → 裸 npm', () => {
    expect(staticUpgradeFallback('gemini_cli')).toBe('npm i -g @google/gemini-cli@latest')
  })
  it('hermes → hermes update || 官方 installer', () => {
    const command = staticUpgradeFallback('hermes')
    expect(command).toContain('hermes update || bash -c')
    expect(command).toContain('https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh')
    expect(command).not.toContain('pip')
    expect(command).not.toContain('python')
    expect(command.split('||')[1]).not.toContain('|')
  })

  it('hermes install → 官方 installer，不依赖系统 pip/python', () => {
    expect(INSTALL_COMMAND.hermes).toContain('bash -c')
    expect(INSTALL_COMMAND.hermes).toContain('https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh')
    expect(INSTALL_COMMAND.hermes).not.toContain('pip')
    expect(INSTALL_COMMAND.hermes).not.toContain('python')
    expect(INSTALL_COMMAND.hermes).not.toContain('|')
  })
})

describe('brewFormulaFromPath', () => {
  it('Cellar 路径 → formula 名', () => {
    expect(brewFormulaFromPath('/opt/homebrew/Cellar/gemini-cli/0.46.0/bin/gemini')).toBe('gemini-cli')
  })
  it('非 Cellar（homebrew node 装的 npm 全局包）→ undefined', () => {
    expect(brewFormulaFromPath('/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js')).toBeUndefined()
  })
})
