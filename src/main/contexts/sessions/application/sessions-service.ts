import type { SessionMessage, SessionPage, SessionTool, ToolProbe } from '../domain/session'
import type { ScanOpts, SessionSource } from '../domain/session-source'
import { assertPathWithinRoots } from '../infrastructure/fs-helpers'
import { launchTerminal } from './terminal-launch'

export interface DeleteRequest {
  tool: SessionTool
  sourcePath: string
  sessionId: string
}
export interface DeleteOutcome {
  sourcePath: string
  ok: boolean
  error?: string
}

/** readTerminalTemplate：返回当前 settings 里配置的终端模板（空串表示未配置）。 */
export type ReadTerminalTemplate = () => string

export class SessionsService {
  private readonly byTool = new Map<SessionTool, SessionSource>()
  constructor(
    sources: SessionSource[],
    private readonly readTerminalTemplate: ReadTerminalTemplate,
  ) {
    for (const s of sources) this.byTool.set(s.tool, s)
  }

  private source(tool: SessionTool): SessionSource {
    const s = this.byTool.get(tool)
    if (!s) throw new Error(`未知工具 (unknown tool): ${tool}`)
    return s
  }

  async probeTools(): Promise<ToolProbe[]> {
    return Promise.all([...this.byTool.values()].map((s) => s.probe()))
  }

  async listSessions(tool: SessionTool, opts?: ScanOpts): Promise<SessionPage> {
    return this.source(tool).scan(opts)
  }

  async getMessages(tool: SessionTool, sourcePath: string): Promise<SessionMessage[]> {
    return this.source(tool).readMessages(sourcePath)
  }

  async deleteSession(tool: SessionTool, sourcePath: string, sessionId: string): Promise<void> {
    const source = this.source(tool)
    await assertPathWithinRoots(sourcePath, source.roots())
    await source.delete(sourcePath, sessionId)
  }

  async deleteSessions(items: DeleteRequest[]): Promise<DeleteOutcome[]> {
    const out: DeleteOutcome[] = []
    for (const it of items) {
      try {
        await this.deleteSession(it.tool, it.sourcePath, it.sessionId)
        out.push({ sourcePath: it.sourcePath, ok: true })
      } catch (e) {
        out.push({ sourcePath: it.sourcePath, ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    }
    return out
  }

  /** 用 settings 配置的终端模板启动 resume 命令。模板为空则抛错（前端降级为复制）。 */
  resume(command: string, cwd: string | undefined): void {
    launchTerminal(this.readTerminalTemplate(), command, cwd)
  }
}
