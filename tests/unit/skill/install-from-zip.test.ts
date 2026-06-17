import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { SkillApplicationService } from '../../../src/main/contexts/skill/application/skill-application-service'
import type { InstalledSkillRepository } from '../../../src/main/contexts/skill/domain/installed-skill-repository'
import type { InstalledSkill } from '../../../src/main/contexts/skill/domain/installed-skill'
import type { SkillBackupRepository } from '../../../src/main/contexts/skill/domain/skill-backup-repository'
import type { AgentRegistry } from '../../../src/main/agents/domain/agent-registry'

// 内存版仓储：仅覆盖 installFromZip 用到的 findByDirectory/save。
class FakeInstalledRepo implements InstalledSkillRepository {
  readonly byDir = new Map<string, InstalledSkill>()
  private readonly byId = new Map<string, InstalledSkill>()
  async findAll(): Promise<InstalledSkill[]> {
    return [...this.byId.values()]
  }
  async findById(id: string): Promise<InstalledSkill | undefined> {
    return this.byId.get(id)
  }
  async findByDirectory(directory: string): Promise<InstalledSkill | undefined> {
    return this.byDir.get(directory)
  }
  async save(skill: InstalledSkill): Promise<void> {
    this.byId.set(skill.id, skill)
    this.byDir.set(skill.directory, skill)
  }
  async delete(id: string): Promise<void> {
    const s = this.byId.get(id)
    this.byId.delete(id)
    if (s) this.byDir.delete(s.directory)
  }
}

let dir: string
let repo: FakeInstalledRepo
let svc: SkillApplicationService

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'skill-zip-'))
  repo = new FakeInstalledRepo()
  svc = new SkillApplicationService(
    repo,
    null as unknown as SkillBackupRepository,
    null as unknown as AgentRegistry,
  )
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('SkillApplicationService.installFromZip 安全解压', () => {
  it('正常技能目录解压并持久化入库', async () => {
    const ssotRoot = join(dir, 'skills')
    const zipPath = join(dir, 'ok.zip')
    const zip = new AdmZip()
    zip.addFile('good-skill/SKILL.md', Buffer.from('# Good'))
    zip.addFile('good-skill/sub/data.txt', Buffer.from('x'))
    zip.writeZip(zipPath)

    const installed = await svc.installFromZip(zipPath, ssotRoot)

    expect(existsSync(join(ssotRoot, 'good-skill', 'SKILL.md'))).toBe(true)
    expect(readFileSync(join(ssotRoot, 'good-skill', 'SKILL.md'), 'utf8')).toBe('# Good')
    expect(existsSync(join(ssotRoot, 'good-skill', 'sub', 'data.txt'))).toBe(true)
    expect(installed).toHaveLength(1)
    expect(installed[0].directory).toBe('good-skill')
    // 关键：持久化入库（修复前只返回不落库）。
    expect(repo.byDir.has('good-skill')).toBe(true)
  })

  it('拦截条目级路径穿越（foo/../../escape），文件不逃逸 SSOT root', async () => {
    const ssotRoot = join(dir, 'skills')
    const zipPath = join(dir, 'evil.zip')
    const zip = new AdmZip()
    zip.addFile('good-skill/SKILL.md', Buffer.from('# Good'))
    zip.addFile('good-skill/../../pwned.txt', Buffer.from('evil'))
    zip.writeZip(zipPath)

    await svc.installFromZip(zipPath, ssotRoot)

    // 正常文件写入；穿越文件未逃逸到 SSOT root 外。
    expect(existsSync(join(ssotRoot, 'good-skill', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(dir, 'pwned.txt'))).toBe(false)
    expect(existsSync(join(ssotRoot, '..', 'pwned.txt'))).toBe(false)
  })

  it('拦截顶层目录穿越（首段为 ..），不写任何文件、不入库', async () => {
    const ssotRoot = join(dir, 'skills')
    const zipPath = join(dir, 'evil2.zip')
    const zip = new AdmZip()
    zip.addFile('../escaped-top.txt', Buffer.from('evil'))
    zip.writeZip(zipPath)

    const installed = await svc.installFromZip(zipPath, ssotRoot)

    expect(existsSync(join(dir, 'escaped-top.txt'))).toBe(false)
    expect(installed).toHaveLength(0)
    expect(repo.byDir.size).toBe(0)
  })

  it('不存在的 zip 路径抛错', async () => {
    await expect(
      svc.installFromZip(join(dir, 'missing.zip'), join(dir, 'skills')),
    ).rejects.toThrow()
  })
})
