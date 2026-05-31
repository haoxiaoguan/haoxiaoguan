// Unit tests for SkillRepo domain entity invariants.

import { describe, it, expect } from 'vitest'
import { SkillRepo } from '../../../src/main/contexts/skill/domain/skill-repo'

describe('SkillRepo', () => {
  it('creates with required fields and defaults', () => {
    const r = SkillRepo.create({ owner: 'acme', name: 'skills', branch: 'main', added_at: 1000 })
    expect(r.owner).toBe('acme')
    expect(r.name).toBe('skills')
    expect(r.branch).toBe('main')
    expect(r.enabled).toBe(true)
    expect(r.sort_order).toBe(99)
    expect(r.added_at).toBe(1000)
  })

  it('throws when owner is empty', () => {
    expect(() => SkillRepo.create({ owner: '', name: 'skills', branch: 'main', added_at: 1 })).toThrow('owner is required')
  })

  it('throws when name is empty', () => {
    expect(() => SkillRepo.create({ owner: 'acme', name: '', branch: 'main', added_at: 1 })).toThrow('name is required')
  })

  it('throws when branch is empty', () => {
    expect(() => SkillRepo.create({ owner: 'acme', name: 'skills', branch: '', added_at: 1 })).toThrow('branch is required')
  })

  it('fullName returns owner/name', () => {
    const r = SkillRepo.create({ owner: 'acme', name: 'skills', branch: 'main', added_at: 1 })
    expect(r.fullName()).toBe('acme/skills')
  })

  it('githubUrl returns correct URL', () => {
    const r = SkillRepo.create({ owner: 'acme', name: 'skills', branch: 'main', added_at: 1 })
    expect(r.githubUrl()).toBe('https://github.com/acme/skills')
  })

  it('respects explicit enabled=false', () => {
    const r = SkillRepo.create({ owner: 'a', name: 'b', branch: 'main', enabled: false, added_at: 1 })
    expect(r.enabled).toBe(false)
  })
})
