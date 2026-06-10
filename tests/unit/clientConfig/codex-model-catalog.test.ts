import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildCodexCatalogEntries,
  type CatalogModelInput,
} from '../../../src/main/contexts/clientConfig/infrastructure/codex-model-catalog'

// 假 models_cache：原生含 gpt-5.5（用于触发同名碰撞）。
const NATIVE_CACHE = {
  models: [
    { slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list', supported_in_api: true, priority: 9, context_window: 272000 },
    { slug: 'gpt-5.4', display_name: 'GPT-5.4', visibility: 'list', supported_in_api: true, priority: 8, context_window: 272000 },
  ],
}

let dir: string
let cachePath: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hxg-catalog-'))
  cachePath = join(dir, 'models_cache.json')
  await writeFile(cachePath, JSON.stringify(NATIVE_CACHE), 'utf8')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const slugs = (entries: Record<string, unknown>[]): string[] => entries.map((e) => e.slug as string)

describe('buildCodexCatalogEntries — 原生同名碰撞', () => {
  it('OFF(includeNative=false)+第三方与原生同名(gpt-5.5)：必须保留第三方，catalog 不为空（回归）', () => {
    // 这正是「本地5.5反代」模型叫 gpt-5.5 的真实场景：以前被滤光 → catalog 空 → App 回退显示原生。
    const tp: CatalogModelInput[] = [{ id: 'gpt-5.5', displayName: '本地5.5反代' }]
    const entries = buildCodexCatalogEntries(tp, { modelsCachePath: cachePath, includeNative: false })
    expect(entries).toHaveLength(1) // 不再为空
    expect(entries[0].slug).toBe('gpt-5.5') // slug 保持原样（路由到 8080 用）
    expect(entries[0].display_name).toBe('本地5.5反代') // 调用方提供 displayName 时原样使用
    expect(entries[0].supports_websockets).toBe(false)
    expect(Number.isInteger(entries[0].priority)).toBe(true) // i32 安全
    // 无原生条目（OFF 是替换式）
    expect(slugs(entries).filter((s) => s === 'gpt-5.5')).toHaveLength(1)
  })

  it('ON(includeNative=true)+第三方与原生同名：跳过第三方，保原生，避免菜单重复/路由歧义', () => {
    const tp: CatalogModelInput[] = [{ id: 'gpt-5.5', displayName: '本地5.5反代' }]
    const entries = buildCodexCatalogEntries(tp, { modelsCachePath: cachePath, includeNative: true })
    // 含两条原生，gpt-5.5 仅一条（原生那条），第三方 gpt-5.5 被去重跳过。
    expect(slugs(entries).filter((s) => s === 'gpt-5.5')).toHaveLength(1)
    const g = entries.find((e) => e.slug === 'gpt-5.5')!
    expect(g.display_name).toBe('GPT-5.5') // 是原生那条（无「号小管」后缀）
    expect(slugs(entries)).toContain('gpt-5.4')
  })

  it('OFF+第三方不与原生同名：1 条第三方、0 条原生', () => {
    const tp: CatalogModelInput[] = [{ id: 'claude-sonnet-4.5', displayName: 'Claude' }]
    const entries = buildCodexCatalogEntries(tp, { modelsCachePath: cachePath, includeNative: false })
    expect(entries).toHaveLength(1)
    expect(entries[0].slug).toBe('claude-sonnet-4.5')
    expect(slugs(entries)).not.toContain('gpt-5.5') // 无原生
  })

  it('ON+第三方不与原生同名：原生 + 第三方共存', () => {
    const tp: CatalogModelInput[] = [{ id: 'claude-sonnet-4.5', displayName: 'Claude' }]
    const entries = buildCodexCatalogEntries(tp, { modelsCachePath: cachePath, includeNative: true })
    expect(slugs(entries)).toContain('gpt-5.5') // 原生在
    expect(slugs(entries)).toContain('gpt-5.4')
    expect(slugs(entries)).toContain('claude-sonnet-4.5') // 第三方也在
  })
})

describe('buildCodexCatalogEntries — ON 撞名别名（C3）', () => {
  it('ON + 第三方用 -hxg 别名（alias 不等于任何原生 slug）：alias + 原生共存，无 skip', () => {
    // service 在 ON+responses 撞名时已把 id 改为 gpt-5.5-hxg，传入 catalog 时不再撞名。
    // catalog 应保留 gpt-5.5-hxg 条目（第三方）+ gpt-5.5（原生），共存。
    const tp: CatalogModelInput[] = [{ id: 'gpt-5.5-hxg', displayName: '本地5.5反代' }]
    const entries = buildCodexCatalogEntries(tp, { modelsCachePath: cachePath, includeNative: true })
    // 原生 gpt-5.5 在
    expect(slugs(entries)).toContain('gpt-5.5')
    // 别名 gpt-5.5-hxg 也在（不与原生 slug 完全匹配，不被 skip）
    expect(slugs(entries)).toContain('gpt-5.5-hxg')
    // gpt-5.5 只有一条（原生那条）
    expect(slugs(entries).filter((s) => s === 'gpt-5.5')).toHaveLength(1)
    // display_name 原样使用调用方填入的 displayName（'本地5.5反代'）
    const aliasEntry = entries.find((e) => e.slug === 'gpt-5.5-hxg')!
    expect(String(aliasEntry.display_name)).toBe('本地5.5反代')
  })

  it('ON + 第三方原名撞原生（未做别名时的旧行为）：第三方条目仍被 skip（向后兼容）', () => {
    // 这个 case 验证：若 service 没有做别名（仍传原名），catalog 旧行为不变（skip 同名第三方）。
    const tp: CatalogModelInput[] = [{ id: 'gpt-5.5', displayName: '直接撞名' }]
    const entries = buildCodexCatalogEntries(tp, { modelsCachePath: cachePath, includeNative: true })
    // gpt-5.5 只有原生那条（第三方被 skip）
    expect(slugs(entries).filter((s) => s === 'gpt-5.5')).toHaveLength(1)
    const g = entries.find((e) => e.slug === 'gpt-5.5')!
    expect(g.display_name).toBe('GPT-5.5') // 是原生那条
  })
})
