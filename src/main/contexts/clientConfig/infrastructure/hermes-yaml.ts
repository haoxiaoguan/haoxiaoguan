// Hermes config.yaml 受控读写工具（纯函数，基于 js-yaml）。
// 注意：js-yaml dump 不保留注释（重排但不丢键）——MVP 接受此权衡。
import yaml from 'js-yaml'
import { ClientConfigCorruptError } from '../domain/client-writer'

/** 解析 YAML mapping：null/空 → {}；解析失败/非 mapping → 抛 ClientConfigCorruptError（拒绝覆盖损坏文件）。 */
export function parseYamlObject(raw: string | null, file: string): Record<string, unknown> {
  if (raw === null || raw.trim() === '') return {}
  let parsed: unknown
  try {
    parsed = yaml.load(raw)
  } catch {
    throw new ClientConfigCorruptError(file, `Hermes config.yaml 解析失败，拒绝写入：${file}`)
  }
  if (parsed === null || parsed === undefined) return {}
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ClientConfigCorruptError(file, `Hermes config.yaml 顶层不是 mapping，拒绝写入：${file}`)
  }
  return parsed as Record<string, unknown>
}

export function stringifyYaml(obj: Record<string, unknown>): string {
  // lineWidth:-1 不折行(保住长 URL/key);noRefs 禁锚点引用(可读)。
  return yaml.dump(obj, { lineWidth: -1, noRefs: true })
}
