// Unit tests for McpServer domain aggregate.
// Pure — no I/O, no Electron.

import { describe, it, expect } from 'vitest'
import { McpServer } from '../../../src/main/contexts/mcp/domain/mcp-server'
import type { McpServerSpec } from '../../../src/main/contexts/mcp/domain/mcp-server'

const STDIO_SPEC: McpServerSpec = {
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem'],
  env: null,
  url: null,
}

const HTTP_SPEC: McpServerSpec = {
  transport: 'http',
  command: null,
  args: null,
  env: null,
  url: 'http://localhost:3000/mcp',
}

describe('McpServer.create', () => {
  it('sets created_at and updated_at to now', () => {
    const now = 1700000000
    const s = McpServer.create({ id: 'abc', name: 'test', spec: STDIO_SPEC, now })
    expect(s.created_at).toBe(now)
    expect(s.updated_at).toBe(now)
  })

  it('defaults description/homepage/docs to null', () => {
    const s = McpServer.create({ id: 'x', name: 'x', spec: STDIO_SPEC, now: 0 })
    expect(s.description).toBeNull()
    expect(s.homepage).toBeNull()
    expect(s.docs).toBeNull()
  })

  it('defaults tags to empty array', () => {
    const s = McpServer.create({ id: 'x', name: 'x', spec: STDIO_SPEC, now: 0 })
    expect(s.tags).toEqual([])
  })

  it('defaults sort_order to 0', () => {
    const s = McpServer.create({ id: 'x', name: 'x', spec: STDIO_SPEC, now: 0 })
    expect(s.sort_order).toBe(0)
  })

  it('populates apps from record', () => {
    const s = McpServer.create({
      id: 'x',
      name: 'x',
      spec: STDIO_SPEC,
      apps: { claude: true, codex: false },
      now: 0,
    })
    expect(s.apps.get('claude')).toBe(true)
    expect(s.apps.get('codex')).toBe(false)
  })

  it('ignores unknown agent ids in apps record', () => {
    const s = McpServer.create({
      id: 'x',
      name: 'x',
      spec: STDIO_SPEC,
      apps: { unknown_agent: true } as Record<string, boolean>,
      now: 0,
    })
    expect(s.apps.size).toBe(0)
  })
})

describe('McpServer.fromRow', () => {
  it('round-trips through JSON columns', () => {
    const original = McpServer.create({
      id: 'row-test',
      name: 'Row Test',
      description: 'desc',
      spec: HTTP_SPEC,
      apps: { claude: true, gemini: false },
      homepage: 'https://example.com',
      docs: 'https://docs.example.com',
      tags: ['tag1', 'tag2'],
      sort_order: 5,
      now: 1700000000,
    })

    const restored = McpServer.fromRow({
      id: original.id,
      name: original.name,
      description: original.description,
      server_json: original.specToJson(),
      apps_json: original.appsToJson(),
      homepage: original.homepage,
      docs: original.docs,
      tags_json: original.tagsToJson(),
      created_at: original.created_at,
      updated_at: original.updated_at,
      sort_order: original.sort_order,
    })

    expect(restored.id).toBe('row-test')
    expect(restored.name).toBe('Row Test')
    expect(restored.description).toBe('desc')
    expect(restored.spec).toEqual(HTTP_SPEC)
    expect(restored.apps.get('claude')).toBe(true)
    expect(restored.apps.get('gemini')).toBe(false)
    expect(restored.homepage).toBe('https://example.com')
    expect(restored.docs).toBe('https://docs.example.com')
    expect(restored.tags).toEqual(['tag1', 'tag2'])
    expect(restored.sort_order).toBe(5)
    expect(restored.created_at).toBe(1700000000)
    expect(restored.updated_at).toBe(1700000000)
  })

  it('handles corrupt server_json gracefully', () => {
    const s = McpServer.fromRow({
      id: 'x',
      name: 'x',
      description: null,
      server_json: 'not-json',
      apps_json: '{}',
      homepage: null,
      docs: null,
      tags_json: '[]',
      created_at: 0,
      updated_at: 0,
      sort_order: 0,
    })
    expect(s.spec.transport).toBe('stdio')
  })

  it('handles corrupt apps_json gracefully', () => {
    const s = McpServer.fromRow({
      id: 'x',
      name: 'x',
      description: null,
      server_json: JSON.stringify(STDIO_SPEC),
      apps_json: 'bad',
      homepage: null,
      docs: null,
      tags_json: '[]',
      created_at: 0,
      updated_at: 0,
      sort_order: 0,
    })
    expect(s.apps.size).toBe(0)
  })
})

describe('McpServer domain behaviour', () => {
  it('isEnabledFor returns true only when flag is true', () => {
    const s = McpServer.create({
      id: 'x',
      name: 'x',
      spec: STDIO_SPEC,
      apps: { claude: true, codex: false },
      now: 0,
    })
    expect(s.isEnabledFor('claude')).toBe(true)
    expect(s.isEnabledFor('codex')).toBe(false)
    expect(s.isEnabledFor('gemini')).toBe(false)
  })

  it('enabledAgents returns only true entries', () => {
    const s = McpServer.create({
      id: 'x',
      name: 'x',
      spec: STDIO_SPEC,
      apps: { claude: true, codex: false, gemini: true },
      now: 0,
    })
    const enabled = s.enabledAgents()
    expect(enabled).toContain('claude')
    expect(enabled).toContain('gemini')
    expect(enabled).not.toContain('codex')
  })

  it('setApp updates the apps map', () => {
    const s = McpServer.create({ id: 'x', name: 'x', spec: STDIO_SPEC, now: 0 })
    s.setApp('claude', true)
    expect(s.isEnabledFor('claude')).toBe(true)
    s.setApp('claude', false)
    expect(s.isEnabledFor('claude')).toBe(false)
  })

  it('touch updates updated_at', () => {
    const s = McpServer.create({ id: 'x', name: 'x', spec: STDIO_SPEC, now: 1000 })
    s.touch(2000)
    expect(s.updated_at).toBe(2000)
    expect(s.created_at).toBe(1000) // created_at must not change
  })
})

describe('McpServer.toDto', () => {
  it('converts apps Map to plain Record', () => {
    const s = McpServer.create({
      id: 'dto-test',
      name: 'DTO Test',
      spec: STDIO_SPEC,
      apps: { claude: true, codex: false },
      now: 1700000000,
    })
    const dto = s.toDto()
    expect(dto.apps).toEqual({ claude: true, codex: false })
    expect(dto.id).toBe('dto-test')
    expect(dto.spec).toEqual(STDIO_SPEC)
  })
})

describe('McpServer JSON serialisation', () => {
  it('specToJson / specFromJson round-trip', () => {
    const json = JSON.stringify(STDIO_SPEC)
    const parsed = McpServer.specFromJson(json)
    expect(parsed).toEqual(STDIO_SPEC)
  })

  it('appsToJson / appsFromJson round-trip', () => {
    const s = McpServer.create({
      id: 'x',
      name: 'x',
      spec: STDIO_SPEC,
      apps: { claude: true, gemini_cli: false },
      now: 0,
    })
    const json = s.appsToJson()
    const map = McpServer.appsFromJson(json)
    expect(map.get('claude')).toBe(true)
    expect(map.get('gemini_cli')).toBe(false)
  })

  it('tagsToJson / tagsFromJson round-trip', () => {
    const s = McpServer.create({
      id: 'x',
      name: 'x',
      spec: STDIO_SPEC,
      tags: ['a', 'b', 'c'],
      now: 0,
    })
    const json = s.tagsToJson()
    const tags = McpServer.tagsFromJson(json)
    expect(tags).toEqual(['a', 'b', 'c'])
  })
})
