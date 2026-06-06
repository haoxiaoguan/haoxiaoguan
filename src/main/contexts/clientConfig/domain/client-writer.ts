// 客户端配置写入器契约（纯渲染，不碰 I/O）。
// 给定 live 文件内容 + 接入档输入 → 算出新内容；I/O（读/快照/原子写）由 application 层 applier 负责。
import type { ClientId, WriteMode, ProfileSource } from './client-profile'

/** 文件绝对路径 → 内容（null = 文件不存在）。 */
export type FileBundle = Record<string, string | null>

/** 写入一份接入档时的输入（apiKey 已解密为明文，仅在内存中流转）。 */
export interface ApplyInput {
  profileId: string
  /** 接入档显示名（累加式写入器写进 provider 名）。 */
  name: string
  source: ProfileSource
  baseUrl: string
  apiKey: string
  model?: string
  /** 累加式:本次注入是否同时设为默认指针（写客户端顶层默认模型）。切换式写入器忽略。 */
  isDefault?: boolean
}

/** 配置文件无法安全解析（损坏/非预期结构）→ 拒绝写入，由上层提示用户修复。 */
export class ClientConfigCorruptError extends Error {
  readonly file: string
  constructor(file: string, reason: string) {
    super(reason)
    this.name = 'ClientConfigCorruptError'
    this.file = file
  }
}

/** 客户端配置写入器：纯渲染。renderApply/renderClear 不读写磁盘，仅基于传入的 current 计算。 */
export interface ClientConfigWriter {
  readonly clientId: ClientId
  readonly writeMode: WriteMode
  /** 本写入器管理的配置文件绝对路径（≥1）。 */
  configFiles(): string[]
  /** 把接入档写入 live → 新内容（只动自己的字段，保留用户其余配置）。损坏抛 ClientConfigCorruptError。 */
  renderApply(current: FileBundle, input: ApplyInput): FileBundle
  /** 移除号小管写入的配置（还原）。 */
  renderClear(current: FileBundle, profileId: string): FileBundle
}
