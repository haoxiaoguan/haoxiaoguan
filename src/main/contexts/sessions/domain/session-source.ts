import type { SessionMessage, SessionPage, SessionTool, ToolProbe } from './session'

export interface ScanOpts {
  limit?: number
  offset?: number
}

/** 单工具来源适配器。probe 廉价（仅 mtime）；scan 按 mtime 倒序分页解析。 */
export interface SessionSource {
  readonly tool: SessionTool
  /** 廉价探测：是否有会话 + 最新会话文件 mtime（不解析内容）。 */
  probe(): Promise<ToolProbe>
  /** 按 mtime 倒序分页解析。items 可能少于 limit（解析跳过的不计入）。 */
  scan(opts?: ScanOpts): Promise<SessionPage>
  /** 懒加载某会话全部消息。 */
  readMessages(sourcePath: string): Promise<SessionMessage[]>
  /** 物理删除（含 sidecar）。删前由调用方做越界校验。 */
  delete(sourcePath: string, sessionId: string): Promise<void>
  /** 合法根目录（越界校验用）。 */
  roots(): string[]
}

export const DEFAULT_PAGE_LIMIT = 200
