// Unit tests for InstalledSkill domain aggregate invariants.

import { describe, it, expect } from 'vitest'
import { InstalledSkill, parseStorageLocation } from '../../../src/main/contexts/skill/domain/installed-skill'

const BASE = {
  id: 'test-id',
  name: 'my-skill',
  directory: 'my-skill',
  apps: { cursor: true, codex: false },
  installed_at: 1000,
  updated_at: 1001,
  ssot_path: '/home/user/.haoxiaoguan/skills/my-skill',
}

describe('InstalledSkill', () => {
  it('creates with required fields', () => {
    const s = InstalledSkill.create(BASE)
    expect(s.id).toBe('test-id')
    expect(s.name).toBe('my-skill')
    expect(s.storage_location).toBe('haoxiaoguan')
  })

  it('throws when id is empty', () => {
    expect(() => InstalledSkill.create({ ...BASE, id: '' })).toThrow('id is required')
  })

  it('throws when name is empty', () => {
    expect(() => InstalledSkill.create({ ...BASE, name: '' })).toThrow('name is required')
  })

  it('throws when directory is empty', () => {
    expect(() => InstalledSkill.create({ ...BASE, directory: '' })).toThrow('directory is required')
  })

  it('appsToJson round-trips', () => {
    const s = InstalledSkill.create(BASE)
    const json = s.appsToJson()
    const parsed = InstalledSkill.appsFromJson(json)
    expect(parsed['cursor']).toBe(true)
    expect(parsed['codex']).toBe(false)
  })

  it('appsFromJson silently drops unknown agent ids', () => {
    const json = JSON.stringify({ cursor: true, unknown_agent: true })
    const parsed = InstalledSkill.appsFromJson(json)
    expect(parsed['cursor']).toBe(true)
    expect('unknown_agent' in parsed).toBe(false)
  })

  it('appsFromJson returns empty object on invalid JSON', () => {
    const parsed = InstalledSkill.appsFromJson('not json')
    expect(Object.keys(parsed)).toHaveLength(0)
  })

  it('isEnabledFor returns correct value', () => {
    const s = InstalledSkill.create(BASE)
    expect(s.isEnabledFor('cursor')).toBe(true)
    expect(s.isEnabledFor('codex')).toBe(false)
    expect(s.isEnabledFor('kiro')).toBe(false)
  })

  it('enabledAgents returns only enabled agents', () => {
    const s = InstalledSkill.create(BASE)
    const enabled = s.enabledAgents()
    expect(enabled).toContain('cursor')
    expect(enabled).not.toContain('codex')
  })

  it('toJson / fromJson round-trips', () => {
    const s = InstalledSkill.create({
      ...BASE,
      description: 'A test skill',
      repo_owner: 'owner',
      repo_name: 'repo',
      repo_branch: 'main',
    })
    const json = s.toJson()
    const restored = InstalledSkill.fromJson(json as Record<string, unknown>)
    expect(restored.id).toBe(s.id)
    expect(restored.name).toBe(s.name)
    expect(restored.description).toBe('A test skill')
    expect(restored.repo_owner).toBe('owner')
    expect(restored.apps['cursor']).toBe(true)
  })

  it('apps map is mutable for toggle operations', () => {
    const s = InstalledSkill.create(BASE)
    s.apps['kiro'] = true
    expect(s.isEnabledFor('kiro')).toBe(true)
  })
})

describe('parseStorageLocation', () => {
  it('parses haoxiaoguan', () => {
    expect(parseStorageLocation('haoxiaoguan')).toBe('haoxiaoguan')
  })

  it('parses agent', () => {
    expect(parseStorageLocation('agent')).toBe('agent')
  })

  it('defaults unknown values to haoxiaoguan', () => {
    expect(parseStorageLocation('unknown')).toBe('haoxiaoguan')
  })
})
