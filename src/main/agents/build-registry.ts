// Registry builder — constructs the AgentRegistry with all 17 adapters in the
// canonical AgentId order (the bootstrap registration order) and
// runtime-asserts the count is exactly 17. This is the single place the agents
// layer is assembled; the container/IPC wiring consumes the result.

import { AgentRegistry } from './domain/agent-registry'
import type { AgentClient } from './domain/agent-client'
import { ALL_AGENT_IDS } from './domain/agent-id'

import { CursorAdapter } from './adapters/cursor-adapter'
import { WindsurfAdapter } from './adapters/windsurf-adapter'
import { AntigravityAdapter } from './adapters/antigravity-adapter'
import { GithubCopilotAdapter } from './adapters/github-copilot-adapter'
import { CodebuddyAdapter } from './adapters/codebuddy-adapter'
import { CodebuddyCnAdapter } from './adapters/codebuddy-cn-adapter'
import { TraeAdapter } from './adapters/trae-adapter'
import { ZedAdapter } from './adapters/zed-adapter'
import { KiroAdapter } from './adapters/kiro-adapter'
import { QoderAdapter } from './adapters/qoder-adapter'
import { CodexAdapter } from './adapters/codex-adapter'
import { GeminiCliAdapter } from './adapters/gemini-cli-adapter'
import { ClaudeAdapter } from './adapters/claude-adapter'
import { ClaudeDesktopAdapter } from './adapters/claude-desktop-adapter'
import { GeminiAdapter } from './adapters/gemini-adapter'
import { OpenCodeAdapter } from './adapters/opencode-adapter'
import { HermesAdapter } from './adapters/hermes-adapter'

const EXPECTED_ADAPTER_COUNT = 17

/** Build the registry with all 17 agent adapters. Throws if the count drifts. */
export function buildAgentRegistry(): AgentRegistry {
  const adapters: AgentClient[] = [
    new CursorAdapter(),
    new WindsurfAdapter(),
    new AntigravityAdapter(),
    new GithubCopilotAdapter(),
    new CodebuddyAdapter(),
    new CodebuddyCnAdapter(),
    new TraeAdapter(),
    new ZedAdapter(),
    new KiroAdapter(),
    new QoderAdapter(),
    new CodexAdapter(),
    new GeminiCliAdapter(),
    new ClaudeAdapter(),
    new ClaudeDesktopAdapter(),
    new GeminiAdapter(),
    new OpenCodeAdapter(),
    new HermesAdapter(),
  ]

  if (adapters.length !== EXPECTED_ADAPTER_COUNT) {
    throw new Error(
      `agents registry expected ${EXPECTED_ADAPTER_COUNT} adapters, got ${adapters.length}`,
    )
  }

  const registry = new AgentRegistry(adapters)

  // Defensive: registering by AgentId key means duplicate ids would collapse
  // silently. Assert the registry holds exactly one entry per known AgentId.
  if (registry.count() !== EXPECTED_ADAPTER_COUNT) {
    throw new Error(
      `agents registry has ${registry.count()} unique adapters, expected ${EXPECTED_ADAPTER_COUNT} (duplicate AgentId?)`,
    )
  }
  for (const id of ALL_AGENT_IDS) {
    if (!registry.get(id)) {
      throw new Error(`agents registry missing adapter for '${id}'`)
    }
  }

  return registry
}
