/**
 * 统一出站 transport 工厂（全出站 Kiro 请求共用，含聊天/刷新/额度/模型）。
 *
 * 设计目标：
 *  1. 消除 kiro-upstream-client 与 kiro-identity-client 中两份重复的
 *     undici + currentDispatcher 逻辑，统一成单一实现。
 *  2. 工厂接口可替换：future 原生指纹 sidecar 实现同一 KiroTransport 接口，
 *     container 一处切换即可覆盖全出站路径。
 *  3. 短期 TLS 选项：保守调整 undici connect 参数（minVersion + ciphers）以
 *     降低 Node.js TLS 默认配置的 JA3 暴露面。
 *
 * ⚠️ TLS 降级注意：
 *   此仅降低、不消除 Node TLS JA3 指纹暴露；
 *   cipher 排列尽量接近主流浏览器（Chrome/Firefox），但无法伪造扩展顺序/GREASE/椭圆曲线列表。
 *   完整 TLS 指纹伪装（扩展顺序/GREASE/会话复用）需 native 指纹库（tlsclientwrapper，独立里程碑）。
 *   选用的 cipher 集经保守裁剪，确保仍能与 AWS 后端（q.*.amazonaws.com / oidc.*.amazonaws.com）握手。
 *
 * 扩展点（sidecar 集成）：
 *   实现 KiroTransport 接口，传入 createKiroTransport 的 opts.impl，
 *   或在 container 直接用自定义 transport 替换注入。
 */
import { fetch as undiciFetch, Agent } from 'undici'
import { currentDispatcher } from './dispatcher-context'

// --- Transport 接口（可被 sidecar 替换的最小契约） ---

/**
 * 统一出站请求接口。fetch 语义与 Web Fetch API 兼容：
 * - 聊天路径（kiro-upstream-client）将 Response 包装为 KiroFetchResponse。
 * - 刷新/额度/模型路径（kiro-identity-client）直接使用 Response（与现有 FetchImpl 签名对齐）。
 */
export type KiroTransportFetch = (url: string, init: RequestInit) => Promise<Response>

export interface KiroTransport {
  /**
   * 发起出站 HTTP 请求。
   * 默认实现：undici fetch + per-account proxy dispatcher（由 currentDispatcher() 读取）+
   * 保守 TLS 调整。
   *
   * 【sidecar 扩展点】：future 原生指纹 transport 实现此接口，container 一处注入即覆盖全出站。
   */
  fetch: KiroTransportFetch
}

// --- 短期 TLS 选项（保守降级，不破坏 AWS 握手） ---

/**
 * 保守浏览器对齐 cipher 排列。
 *
 * 选取依据：
 *  - 以 Chrome/Firefox 当前 TLS 1.3 + TLS 1.2 主流 cipher 为参考。
 *  - 保留 AES-GCM 系列（AWS 后端要求）；去掉 Node 默认中的 DES/3DES/RC4/export 等弱 cipher。
 *  - 顺序尽量贴近浏览器偏好（CHACHA20 前置，AES-256 早于 AES-128，GCM 早于 CBC）。
 *  - TLS 1.3 cipher 由 Node 固定，此处不影响。
 *
 * ⚠️ 此仅降低、不消除 Node TLS JA3 暴露；扩展顺序/GREASE/椭圆曲线列表等
 *    需 native 指纹库（tlsclientwrapper，独立里程碑）才能完整伪装。
 */
const BROWSER_ALIGNED_CIPHERS = [
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-SHA384',
  'ECDHE-RSA-AES256-SHA384',
  'ECDHE-ECDSA-AES128-SHA256',
  'ECDHE-RSA-AES128-SHA256',
].join(':')

/**
 * undici Agent connect 选项（短期 TLS 调整）。
 * 仅在无外部 proxy dispatcher 时生效（有 dispatcher 时由 dispatcher 自身的 TLS 配置决定）。
 *
 * ⚠️ 此仅降低、不消除 Node TLS JA3 暴露；详见模块顶部注释。
 */
const CONSERVATIVE_TLS_CONNECT = {
  /** 强制 TLS 1.2 最低版本（Node 默认已为 TLSv1.2，此处显式声明便于追踪）。 */
  minVersion: 'TLSv1.2' as const,
  /** 保守浏览器对齐 cipher 顺序，减少 JA3 指纹与纯 Node.js 默认的差异。 */
  ciphers: BROWSER_ALIGNED_CIPHERS,
}

// --- 默认 transport 实现 ---

/**
 * 默认 Kiro 出站 transport：undici fetch + per-account proxy dispatcher + 短期 TLS 调整。
 *
 * 生命周期：模块级单例（Agent 在进程内复用连接池）。
 * 有 proxy dispatcher 时直接使用 dispatcher（dispatcher 自身持有连接池）；
 * 无 dispatcher 时使用模块级 Agent 携带 TLS 调整选项。
 */
const defaultTlsAgent = new Agent({
  connect: CONSERVATIVE_TLS_CONNECT,
})

async function defaultKiroTransportFetch(url: string, init: RequestInit): Promise<Response> {
  const dispatcher = currentDispatcher()
  if (dispatcher !== undefined) {
    // proxy dispatcher 持有连接池，直接委托（TLS 选项由 proxy dispatcher 自身管理）。
    return (await undiciFetch(url, {
      ...(init as Parameters<typeof undiciFetch>[1]),
      dispatcher,
    })) as unknown as Response
  }
  // 直连：使用带 TLS 调整的 Agent。
  return (await undiciFetch(url, {
    ...(init as Parameters<typeof undiciFetch>[1]),
    dispatcher: defaultTlsAgent,
  })) as unknown as Response
}

// --- 全进程统一注入点（G2：原生 TLS 指纹 sidecar 就绪后一处覆盖全出站） ---

// 模块级「当前生效实现」。聊天/刷新+额度+模型/oauth 三处经 createKiroTransport()（无 opts.impl）
// 创建的 transport，其 fetch 在【调用时】读取此值，故 container 在 sidecar 就绪后只需调用一次
// setKiroTransportImpl 即覆盖全部出站路径，从根上杜绝「漏一条致 JA3 指纹分裂」。
let activeKiroTransportImpl: KiroTransportFetch | undefined

/**
 * 设置/清除全进程统一出站实现（G2 单一注入点，仅 container 调用）。
 * - 传入原生指纹 transport → 全出站（含模块加载时已创建的 upstream/identity 单例 +
 *   每个 KiroOAuthCapability）即时切换（它们的 fetch 调用时动态读取此值）。
 * - 传 undefined → 回退默认 undici + per-account dispatcher + 保守 TLS。
 */
export function setKiroTransportImpl(impl: KiroTransportFetch | undefined): void {
  activeKiroTransportImpl = impl
}

/** 当前生效出站实现（activeImpl 优先，否则默认）。供 createKiroTransport 调用时动态解析。 */
function resolveActiveKiroFetch(): KiroTransportFetch {
  return activeKiroTransportImpl ?? defaultKiroTransportFetch
}

// --- 工厂函数 ---

export interface CreateKiroTransportOpts {
  /**
   * 替换默认实现（测试注入 / sidecar 接入）。
   *
   * 【sidecar 扩展点】：future 原生指纹 transport 通过此参数注入，
   * container 一处配置即可将全出站路径切换为指纹伪装实现。
   * 实现要求：满足 KiroTransportFetch 签名，自行管理 TLS/代理配置。
   */
  impl?: KiroTransportFetch
}

/**
 * 创建一个 KiroTransport 实例。
 *
 * 默认实现：undici + per-account proxy dispatcher（currentDispatcher）+ 短期保守 TLS 调整。
 * 注入 opts.impl 可替换为任意实现（mock 或 sidecar）。
 *
 * 用法（container）：
 *   const transport = createKiroTransport()
 *   // 注入 kiro-upstream-client 的 fetchImpl（包装后适配 KiroFetchResponse）
 *   // 注入 kiro-identity-client 的 fetchImpl（直接传递，签名兼容）
 *
 * 【sidecar 扩展点】：指纹 sidecar 就绪后，container 改为：
 *   const transport = createKiroTransport({ impl: fingerprintTransportFetch })
 */
export function createKiroTransport(opts: CreateKiroTransportOpts = {}): KiroTransport {
  // opts.impl（测试/显式注入）优先且固定；否则返回【调用时】动态读取 activeKiroTransportImpl 的
  // 包装，使 container 一处 setKiroTransportImpl 即覆盖所有 createKiroTransport() 消费者
  // （含本模块加载前已创建的 upstream/identity 单例）。
  const explicit = opts.impl
  if (explicit !== undefined) {
    return { fetch: explicit }
  }
  return { fetch: (url, init) => resolveActiveKiroFetch()(url, init) }
}

// 导出 TLS 选项常量供测试断言（不对外暴露 Agent 实例）。
export { CONSERVATIVE_TLS_CONNECT }
