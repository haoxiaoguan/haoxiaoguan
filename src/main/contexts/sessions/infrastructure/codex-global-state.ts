import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { atomicWrite } from '../../../platform/fs/atomic-write'
import { toDesktopWorkspacePath } from './codex-rollout-rewrite'

// ─── helpers ─────────────────────────────────────────────────────────────────

/** 对齐 Rust path_array */
function pathArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  }
  if (typeof v === 'string' && v.trim().length > 0) {
    return [v]
  }
  return []
}

/** 对齐 Rust dedupe_paths */
function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const path of paths) {
    const desktop = toDesktopWorkspacePath(path)
    if (desktop === undefined) continue
    const comparable = desktop.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
    if (!seen.has(comparable)) {
      seen.add(comparable)
      result.push(desktop)
    }
  }
  return result
}

/** 深比较两个 JSON 值是否相同 */
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// ─── normalizeGlobalState ─────────────────────────────────────────────────────

/**
 * 对齐 Rust normalized_global_state:
 * 只处理存在的键；不存在的键不产出。
 */
export function normalizeGlobalState(state: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {}

  if ('electron-saved-workspace-roots' in state) {
    next['electron-saved-workspace-roots'] = dedupePaths(pathArray(state['electron-saved-workspace-roots']))
  }

  if ('project-order' in state) {
    next['project-order'] = dedupePaths(pathArray(state['project-order']))
  }

  if ('active-workspace-roots' in state) {
    const v = state['active-workspace-roots']
    const normalized = dedupePaths(pathArray(v))
    if (Array.isArray(v)) {
      next['active-workspace-roots'] = normalized
    } else if (normalized.length > 0) {
      next['active-workspace-roots'] = normalized[0]
    } else {
      next['active-workspace-roots'] = v
    }
  }

  if ('electron-workspace-root-labels' in state) {
    const v = state['electron-workspace-root-labels']
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const labels: Record<string, unknown> = {}
      for (const [key, item] of Object.entries(v as Record<string, unknown>)) {
        labels[toDesktopWorkspacePath(key) ?? key] = item
      }
      next['electron-workspace-root-labels'] = labels
    }
  }

  if ('open-in-target-preferences' in state) {
    const v = state['open-in-target-preferences']
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const openTargets = { ...(v as Record<string, unknown>) }
      const perPath = openTargets['perPath']
      if (perPath !== null && perPath !== undefined && typeof perPath === 'object' && !Array.isArray(perPath)) {
        const nextPerPath: Record<string, unknown> = {}
        for (const [key, item] of Object.entries(perPath as Record<string, unknown>)) {
          nextPerPath[toDesktopWorkspacePath(key) ?? key] = item
        }
        openTargets['perPath'] = nextPerPath
      }
      next['open-in-target-preferences'] = openTargets
    }
  }

  return next
}

// ─── load / count / apply ─────────────────────────────────────────────────────

async function loadGlobalState(path: string): Promise<Record<string, unknown>> {
  if (!existsSync(path)) return {}
  try {
    const text = await readFile(path, 'utf8')
    const parsed = JSON.parse(text)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return {}
  } catch {
    return {}
  }
}

/** 对齐 Rust count_global_state_updates: normalize 后逐键与原值 JSON 深比较。 */
export async function countGlobalStateUpdates(path: string): Promise<number> {
  const state = await loadGlobalState(path)
  const next = normalizeGlobalState(state)
  let count = 0
  for (const [key, value] of Object.entries(next)) {
    if (!deepEqual(state[key], value)) count++
  }
  return count
}

/**
 * 对齐 Rust apply_global_state_update:
 * 读 JSON(不存在→{})，normalize，若有变更：合并写回 path(pretty,2空格) + 同写 ${path}.bak；
 * 返回变更键数。
 */
export async function applyGlobalStateUpdate(path: string): Promise<number> {
  const state = await loadGlobalState(path)
  const next = normalizeGlobalState(state)
  const changed: Array<[string, unknown]> = []
  for (const [key, value] of Object.entries(next)) {
    if (!deepEqual(state[key], value)) {
      changed.push([key, value])
    }
  }
  if (changed.length === 0) return 0

  const merged = { ...state }
  for (const [key, value] of changed) {
    merged[key] = value
  }
  const text = JSON.stringify(merged, null, 2)
  await atomicWrite(path, text)
  await atomicWrite(path + '.bak', text)
  return changed.length
}
