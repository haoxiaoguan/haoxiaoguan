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
  /** 客户端专属配置（per-client 额外字段:opencode.npm / openclaw.api / hermes.apiMode）。 */
  settings?: Record<string, unknown>
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

/** beforeWrite 返回、afterWrite 收回的句柄：记录写盘前是否停掉了进程。 */
export interface WriteLifecycleToken {
  /** 写盘前是否真的停掉了进程（afterWrite 据此决定是否重启）。 */
  restart: boolean
}

/**
 * 写盘前后的进程生命周期钩子。仅 Codex 桌面 App 需要：
 * 运行中的 Codex App 把供应商配置存在内存里、并按内存反向重写 ~/.codex/config.toml，
 * 会抹掉外部编辑。必须「停 App → 写盘 → 重启 App」才能让改动被 App 在启动时采纳。
 * 其它客户端（Claude/Gemini/OpenCode…）不读不反写，无需此钩子。
 */
export interface WriteLifecycle {
  /**
   * 写盘前调用：停掉会反写配置的进程。返回句柄给 afterWrite。
   * 若进程仍无法安全停掉应抛错，使本次写入中止（避免写了被立刻抹掉造成「没生效」）。
   */
  beforeWrite(): Promise<WriteLifecycleToken>
  /** 写盘后调用（无论写成功或回滚都会执行）：按句柄恢复进程（如重启 App）。 */
  afterWrite(token: WriteLifecycleToken): Promise<void>
}

/** 客户端配置写入器：纯渲染。renderApply/renderClear 不读写磁盘，仅基于传入的 current 计算。 */
export interface ClientConfigWriter {
  readonly clientId: ClientId
  readonly writeMode: WriteMode
  /**
   * 可选：写盘前后的进程生命周期钩子（仅 Codex 桌面 App 挂载：停→写→启）。
   * 由 application 层 applier 在 apply/clear 落盘时包裹调用。
   */
  readonly lifecycle?: WriteLifecycle
  /** 本写入器管理的配置文件绝对路径（≥1）。 */
  configFiles(): string[]
  /** 把接入档写入 live → 新内容（只动自己的字段，保留用户其余配置）。损坏抛 ClientConfigCorruptError。 */
  renderApply(current: FileBundle, input: ApplyInput): FileBundle
  /** 移除号小管写入的配置（还原）。 */
  renderClear(current: FileBundle, profileId: string): FileBundle
}
