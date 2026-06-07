// 协议判定：客户端原生协议 vs 第三方上游协议 → 直连 or 经号小管反代。
import type { ClientId } from './client-profile'

/** 客户端原生协议 / 第三方上游协议。openai-chat 与 openai-responses 必须区分(Codex 只会 responses)。 */
export type WireProtocol = 'anthropic' | 'openai-chat' | 'openai-responses' | 'gemini'

/** 客户端的原生协议；'flexible' 表示该客户端可按 provider 适配器自选协议(总能与第三方匹配，直连)。 */
export type ClientNativeProtocol = WireProtocol | 'flexible'

/**
 * 每客户端原生协议：
 * - claude(Claude Code) → anthropic（只会 Anthropic Messages）
 * - codex → openai-responses（只会 Responses API）
 * - gemini_cli → gemini
 * - opencode/openclaw/hermes → flexible（provider 配置里自带 npm 适配器/api 协议/api_mode，可适配任意上游协议）
 */
export const CLIENT_NATIVE_PROTOCOL: Record<ClientId, ClientNativeProtocol> = {
  claude: 'anthropic',
  codex: 'openai-responses',
  gemini_cli: 'gemini',
  opencode: 'flexible',
  openclaw: 'flexible',
  hermes: 'flexible',
}

export type RelayDecision = 'direct' | 'relay'

/**
 * 判定：给定客户端原生协议与第三方上游协议，决定客户端直连第三方还是经号小管反代转换。
 * - flexible 客户端 → 永远 direct（provider 自带适配器，可配成与上游一致）
 * - 协议相同 → direct
 * - 否则 → relay（号小管反代做协议转换）
 */
export function resolveRelayDecision(
  clientNative: ClientNativeProtocol,
  thirdPartyProtocol: WireProtocol,
): RelayDecision {
  if (clientNative === 'flexible') return 'direct'
  return clientNative === thirdPartyProtocol ? 'direct' : 'relay'
}

/** 便捷：按 clientId 直接判定。 */
export function resolveRelayDecisionForClient(clientId: ClientId, thirdPartyProtocol: WireProtocol): RelayDecision {
  return resolveRelayDecision(CLIENT_NATIVE_PROTOCOL[clientId], thirdPartyProtocol)
}
