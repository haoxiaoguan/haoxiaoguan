import { httpFetch } from '../../quota/infrastructure/http/common'
import { compareSemver } from '../domain/semver'
import type { ClientId } from '../domain/client-profile'
import { LATEST_SOURCE } from '../domain/client-version'

// 客户端最新版获取（对称移植 cc-switch fetch_npm_latest_for_tool / fetch_pypi /
// fetch_github + pick_latest_version）。走项目的 httpFetch（代理上下文感知）。
// 任何失败/离线一律返回 undefined（UI 退化为「已安装」，不报错）。

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  try {
    const resp = await httpFetch(url, { method: 'GET', headers }, `拉取最新版本失败: ${url}`)
    if (!resp.ok) return undefined
    return await resp.json()
  } catch {
    return undefined
  }
}

function asObject(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

async function npmDistTags(pkg: string): Promise<Record<string, unknown> | undefined> {
  const json = asObject(await getJson(`https://registry.npmjs.org/${pkg}`))
  return json ? asObject(json['dist-tags']) : undefined
}

/** 取 latest；本地版本严格领先 latest 时按预发布通道补查（复用同一次响应）。 */
function pickLatest(
  tags: Record<string, unknown>,
  prereleaseTags: readonly string[],
  local?: string,
): string | undefined {
  const latest = str(tags.latest)
  if (latest === undefined) return undefined
  const localAhead = local !== undefined && compareSemver(local, latest) === 1
  if (prereleaseTags.length === 0 || !localAhead) return latest
  let best = latest
  for (const tag of prereleaseTags) {
    const cand = str(tags[tag])
    if (cand !== undefined && compareSemver(cand, best) === 1) best = cand
  }
  return best
}

async function githubLatest(repo: string): Promise<string | undefined> {
  const json = asObject(
    await getJson(`https://api.github.com/repos/${repo}/releases/latest`, {
      'User-Agent': 'haoxiaoguan',
      Accept: 'application/vnd.github+json',
    }),
  )
  const tag = json ? str(json.tag_name) : undefined
  return tag === undefined ? undefined : tag.replace(/^v/, '')
}

async function pypiLatest(pkg: string): Promise<string | undefined> {
  const json = asObject(await getJson(`https://pypi.org/pypi/${pkg}/json`))
  const info = json ? asObject(json.info) : undefined
  return info ? str(info.version) : undefined
}

export async function fetchLatestVersion(clientId: ClientId, localVersion?: string): Promise<string | undefined> {
  const src = LATEST_SOURCE[clientId]
  if (src.kind === 'pypi') return pypiLatest(src.pkg)
  const tags = await npmDistTags(src.pkg)
  if (tags !== undefined) {
    const v = pickLatest(tags, src.prereleaseTags ?? [], localVersion)
    if (v !== undefined) return v
  }
  if (src.githubFallback !== undefined) return githubLatest(src.githubFallback)
  return undefined
}
