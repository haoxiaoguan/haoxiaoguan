// AgentFamily enum — mirrors Rust agents::domain::agent_family.
// String values are snake_case as serialised by serde(rename_all = "snake_case").
// NOTE: serde snake-cases `VSCode` to "v_s_code" (splits on every case boundary),
// matching the authoritative map. Informational only — no business rules.

export type AgentFamily = 'v_s_code' | 'jet_brains' | 'standalone' | 'cli_agent'

export const ALL_AGENT_FAMILIES: readonly AgentFamily[] = [
  'v_s_code',
  'jet_brains',
  'standalone',
  'cli_agent',
] as const
