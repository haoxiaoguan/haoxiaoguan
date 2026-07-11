// CursorAdapter：apiProxy 的 cursor 上游适配器（implements PlatformUpstreamAdapter）。
// 账号/凭据/代理由 FailoverAdapter 注入 ctx；本类退化为「用注入上下文发一次请求 + classifyError」薄层。
// chat/chatStream：prepare（从 ctx 取号/组 body 形状，同步无 IO）→ runWithDispatcher(ctx.dispatcher)
// 包住 CursorUpstreamClient 调用。
import { runWithDispatcher } from '../../../../../platform/net/dispatcher-context'
import { supportsCursorModel, mapCursorModelId, listCursorModels } from './cursor-model-map'
import { mapCanonicalToCursor } from './cursor-request-mapper'
import { classifyCursorError } from './cursor-error'
import { CursorUpstreamClient, type CursorCallContext } from './cursor-upstream-client'
import type { CursorRequestShape } from './cursor-request-mapper'
import type { KiroCredential, KiroAccountInfo } from '../kiro/kiro-ports'
import type { PlatformUpstreamAdapter, UpstreamCtx, ModelInfo, ErrorClass } from '../../../domain/platform-adapter'
import type { CanonicalRequest, CanonicalResponse, CanonicalStreamEvent } from '../../../domain/canonical'

/** 无可用账号 / 凭据缺失。handleRequest 据此映射 503 友好错误。 */
export class NoCursorAccountError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoCursorAccountError'
  }
}

export interface CursorAdapterDeps {
  client: CursorUpstreamClient
}

interface PreparedCursorCall {
  cursorModelId: string
  shape: CursorRequestShape
  callCtx: CursorCallContext
}

export class CursorAdapter implements PlatformUpstreamAdapter {
  readonly platform = 'cursor'

  constructor(private readonly deps: CursorAdapterDeps) {}

  supportsModel(model: string): boolean {
    return supportsCursorModel(model)
  }

  listModels(): ModelInfo[] {
    return listCursorModels()
  }

  classifyError(err: unknown): ErrorClass {
    return classifyCursorError(err)
  }

  async chat(ir: CanonicalRequest, ctx: UpstreamCtx): Promise<CanonicalResponse> {
    const p = this.prepare(ir, ctx)
    return runWithDispatcher(ctx.dispatcher, () =>
      this.deps.client.chat(p.shape, p.cursorModelId, p.callCtx, ir.model, ir),
    )
  }

  chatStream(ir: CanonicalRequest, ctx: UpstreamCtx): AsyncIterable<CanonicalStreamEvent> {
    const self = this
    async function* gen(): AsyncIterable<CanonicalStreamEvent> {
      const p = self.prepare(ir, ctx)
      const stream = await runWithDispatcher(ctx.dispatcher, () =>
        Promise.resolve(self.deps.client.chatStream(p.shape, p.cursorModelId, p.callCtx, ir.model, ir)),
      )
      for await (const ev of stream) yield ev
    }
    return gen()
  }

  // 从 ctx.account/credential 取路由信息 → 组 body 形状 + callCtx（同步无 IO）。
  private prepare(ir: CanonicalRequest, ctx: UpstreamCtx): PreparedCursorCall {
    const account = ctx.account
    const cred = ctx.credential
    if (account === undefined || cred === undefined) {
      throw new NoCursorAccountError('cursor adapter requires ctx.account and ctx.credential (inject via FailoverAdapter)')
    }

    const machineId = resolveCursorField(account, cred, ['telemetry_machine_id', 'service_machine_id', 'machine_id', 'serviceMachineId'])
    const macMachineId = resolveCursorField(account, cred, ['mac_machine_id', 'macMachineId'])
    const clientVersion = resolveCursorField(account, cred, ['cursor_client_version', 'client_version'])
    const callCtx: CursorCallContext = {
      accessToken: cred.token,
      ...(cred.refreshToken !== undefined ? { refreshToken: cred.refreshToken } : {}),
      ...(machineId !== undefined ? { machineId } : {}),
      ...(macMachineId !== undefined ? { macMachineId } : {}),
      ...(clientVersion !== undefined ? { clientVersion } : {}),
      ghostMode: true,
      ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
    }

    return {
      cursorModelId: mapCursorModelId(ir.model),
      shape: mapCanonicalToCursor(ir),
      callCtx,
    }
  }
}

/** 从凭据 rawMetadata / 账号 profilePayload 按候选键顺序解析字段（多路径兜底）。 */
function resolveCursorField(account: KiroAccountInfo, cred: KiroCredential, keys: string[]): string | undefined {
  return readField(cred.rawMetadata, keys) ?? readField(account.profilePayload, keys)
}

function readField(source: unknown, keys: string[]): string | undefined {
  if (source === null || typeof source !== 'object') return undefined
  const o = source as Record<string, unknown>
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && v.length > 0) return v
  }
  // 兼容 cursor_auth_raw 嵌套。
  const authRaw = o.cursor_auth_raw
  if (authRaw !== null && typeof authRaw === 'object') {
    const inner = authRaw as Record<string, unknown>
    for (const k of keys) {
      const v = inner[k]
      if (typeof v === 'string' && v.length > 0) return v
    }
  }
  return undefined
}
