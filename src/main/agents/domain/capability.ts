// Capability flags — mirrors Rust agents::domain::capability.

export type Capability = 'credential' | 'skills' | 'mcp' | 'session_log'

export const ALL_CAPABILITIES: readonly Capability[] = [
  'credential',
  'skills',
  'mcp',
  'session_log',
] as const

const CREDENTIAL = 0b0001
const SKILLS = 0b0010
const MCP = 0b0100
const SESSION_LOG = 0b1000

function bit(cap: Capability): number {
  switch (cap) {
    case 'credential':
      return CREDENTIAL
    case 'skills':
      return SKILLS
    case 'mcp':
      return MCP
    case 'session_log':
      return SESSION_LOG
  }
}

/**
 * Immutable bitmask value object — mirrors Rust AgentCapabilities(u8).
 * Build with the fluent `none().with(cap)` chain; `with` returns a new instance.
 * `list()` returns set bits in canonical Capability order.
 */
export class AgentCapabilities {
  private constructor(private readonly inner: number) {}

  static none(): AgentCapabilities {
    return new AgentCapabilities(0)
  }

  /** Convenience: build from a set of capabilities in one call. */
  static of(...caps: Capability[]): AgentCapabilities {
    return caps.reduce((acc, c) => acc.with(c), AgentCapabilities.none())
  }

  has(cap: Capability): boolean {
    return (this.inner & bit(cap)) !== 0
  }

  with(cap: Capability): AgentCapabilities {
    return new AgentCapabilities(this.inner | bit(cap))
  }

  /** Set bits, in canonical ALL_CAPABILITIES order (credential, skills, mcp, session_log). */
  list(): Capability[] {
    return ALL_CAPABILITIES.filter((c) => this.has(c))
  }
}

const CAPABILITY_SET = new Set<string>(ALL_CAPABILITIES)

/** Parse a capability string; throws on unknown value (mirrors Rust parse_capability). */
export function parseCapability(s: string): Capability {
  if (CAPABILITY_SET.has(s)) return s as Capability
  throw new Error(`unknown capability: '${s}'`)
}
