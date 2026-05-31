import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonMcpSync, TomlMcpSync } from '../../../src/main/agents/infrastructure/shared/mcp-sync-base'
import type { McpServerSpec } from '../../../src/main/agents/domain/mcp-sync'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agents-mcp-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const STDIO: McpServerSpec = {
  transport: 'stdio',
  command: 'node',
  args: ['server.js'],
  env: { FOO: 'bar' },
  url: null,
}
const HTTP: McpServerSpec = {
  transport: 'http',
  command: null,
  args: null,
  env: null,
  url: 'https://example.com/mcp',
}

describe('JsonMcpSync round-trip', () => {
  it('upsert → list returns the stdio spec (type/command/args/env shape)', async () => {
    const path = join(dir, 'settings.json')
    const sync = new JsonMcpSync(path, 'mcpServers')
    await sync.upsertServer('myserver', STDIO)

    const onDisk = JSON.parse(readFileSync(path, 'utf8'))
    expect(onDisk.mcpServers.myserver).toEqual({
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { FOO: 'bar' },
    })

    const servers = await sync.listServers()
    expect(servers.myserver).toEqual(STDIO)
  })

  it('upsert http spec serializes type/url', async () => {
    const path = join(dir, 'settings.json')
    const sync = new JsonMcpSync(path, 'mcpServers')
    await sync.upsertServer('remote', HTTP)
    const onDisk = JSON.parse(readFileSync(path, 'utf8'))
    expect(onDisk.mcpServers.remote).toEqual({ type: 'http', url: 'https://example.com/mcp' })
  })

  it('upsert preserves unrelated top-level keys', async () => {
    const path = join(dir, 'settings.json')
    writeFileSync(path, JSON.stringify({ theme: 'dark', mcpServers: { existing: { type: 'stdio' } } }))
    const sync = new JsonMcpSync(path, 'mcpServers')
    await sync.upsertServer('new', STDIO)
    const onDisk = JSON.parse(readFileSync(path, 'utf8'))
    expect(onDisk.theme).toBe('dark')
    expect(Object.keys(onDisk.mcpServers).sort()).toEqual(['existing', 'new'])
  })

  it('remove deletes a server; missing file lists empty', async () => {
    const path = join(dir, 'settings.json')
    const sync = new JsonMcpSync(path, 'mcpServers')
    expect(await sync.listServers()).toEqual({})

    await sync.upsertServer('a', STDIO)
    await sync.upsertServer('b', HTTP)
    await sync.removeServer('a')
    const servers = await sync.listServers()
    expect(Object.keys(servers)).toEqual(['b'])
  })

  it('honors a custom key (OpenCode uses "mcp")', async () => {
    const path = join(dir, 'opencode.json')
    const sync = new JsonMcpSync(path, 'mcp')
    await sync.upsertServer('s', STDIO)
    const onDisk = JSON.parse(readFileSync(path, 'utf8'))
    expect(onDisk.mcp.s.command).toBe('node')
  })
})

describe('TomlMcpSync round-trip (Codex config.toml)', () => {
  it('upsert → list a stdio server under [mcp_servers.*]', async () => {
    const path = join(dir, 'config.toml')
    const sync = new TomlMcpSync(path, 'mcp_servers')
    await sync.upsertServer('node_repl', STDIO)

    const servers = await sync.listServers()
    expect(servers.node_repl.transport).toBe('stdio')
    expect(servers.node_repl.command).toBe('node')
    expect(servers.node_repl.args).toEqual(['server.js'])
    expect(servers.node_repl.env).toEqual({ FOO: 'bar' })
  })

  it('remove deletes the table; non-existent file lists empty', async () => {
    const path = join(dir, 'config.toml')
    const sync = new TomlMcpSync(path, 'mcp_servers')
    expect(await sync.listServers()).toEqual({})
    await sync.upsertServer('a', STDIO)
    await sync.upsertServer('b', STDIO)
    await sync.removeServer('a')
    expect(Object.keys(await sync.listServers())).toEqual(['b'])
  })
})
