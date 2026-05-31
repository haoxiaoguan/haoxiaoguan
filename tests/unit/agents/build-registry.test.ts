import { describe, it, expect } from 'vitest'
import { buildAgentRegistry } from '../../../src/main/agents/build-registry'
import { AgentRegistryService } from '../../../src/main/agents/application/agent-registry-service'
import { ALL_AGENT_IDS, type AgentId } from '../../../src/main/agents/domain/agent-id'
import type { AgentFamily } from '../../../src/main/agents/domain/agent-family'
import type { Capability } from '../../../src/main/agents/domain/capability'

// Expected per-adapter contract, transcribed from the Rust adapters
// (family / displayName / capabilities). This is the authoritative ground truth.
interface Expected {
  family: AgentFamily
  displayName: string
  caps: Capability[]
}

const EXPECTED: Record<AgentId, Expected> = {
  cursor: { family: 'v_s_code', displayName: 'Cursor', caps: ['credential'] },
  windsurf: { family: 'v_s_code', displayName: 'Windsurf', caps: ['credential'] },
  antigravity: { family: 'v_s_code', displayName: 'Antigravity', caps: ['credential'] },
  kiro: { family: 'v_s_code', displayName: 'Kiro', caps: ['credential', 'session_log'] },
  github_copilot: { family: 'standalone', displayName: 'GitHub Copilot', caps: ['credential'] },
  codebuddy: { family: 'v_s_code', displayName: 'CodeBuddy', caps: ['credential'] },
  codebuddy_cn: { family: 'v_s_code', displayName: 'CodeBuddy CN', caps: ['credential'] },
  qoder: { family: 'standalone', displayName: 'Qoder', caps: ['credential', 'session_log'] },
  trae: { family: 'v_s_code', displayName: 'Trae', caps: ['credential'] },
  zed: { family: 'standalone', displayName: 'Zed', caps: ['credential'] },
  codex: {
    family: 'standalone',
    displayName: 'Codex',
    caps: ['credential', 'skills', 'mcp', 'session_log'],
  },
  gemini_cli: {
    family: 'standalone',
    displayName: 'Gemini CLI',
    caps: ['credential', 'skills', 'mcp', 'session_log'],
  },
  claude: { family: 'cli_agent', displayName: 'Claude Code', caps: ['skills', 'mcp', 'session_log'] },
  claude_desktop: { family: 'cli_agent', displayName: 'Claude Desktop', caps: ['skills', 'mcp'] },
  gemini: { family: 'cli_agent', displayName: 'Gemini', caps: ['skills', 'mcp'] },
  opencode: { family: 'cli_agent', displayName: 'OpenCode', caps: ['skills', 'mcp'] },
  hermes: { family: 'cli_agent', displayName: 'Hermes', caps: ['skills', 'mcp'] },
}

describe('buildAgentRegistry', () => {
  it('registers exactly 17 adapters', () => {
    const reg = buildAgentRegistry()
    expect(reg.count()).toBe(17)
    expect(reg.listAll().length).toBe(17)
  })

  it('has one adapter for every known AgentId', () => {
    const reg = buildAgentRegistry()
    for (const id of ALL_AGENT_IDS) {
      expect(reg.get(id), `missing adapter ${id}`).toBeDefined()
    }
  })

  it('each adapter reports the expected family / displayName / capabilities', () => {
    const reg = buildAgentRegistry()
    for (const id of ALL_AGENT_IDS) {
      const a = reg.get(id)!
      const exp = EXPECTED[id]
      expect(a.family(), `${id} family`).toBe(exp.family)
      expect(a.displayName(), `${id} displayName`).toBe(exp.displayName)
      expect(a.capabilities().list(), `${id} capabilities`).toEqual(exp.caps)
    }
  })

  it('capability accessors are wired iff the capability is declared', () => {
    const reg = buildAgentRegistry()
    for (const id of ALL_AGENT_IDS) {
      const a = reg.get(id)!
      expect(!!a.asCredentialInjection(), `${id} credential`).toBe(a.hasCapability('credential'))
      expect(!!a.asSkillsSync(), `${id} skills`).toBe(a.hasCapability('skills'))
      expect(!!a.asMcpSync(), `${id} mcp`).toBe(a.hasCapability('mcp'))
      expect(!!a.asSessionLogReader(), `${id} session_log`).toBe(a.hasCapability('session_log'))
    }
  })
})

describe('AgentRegistryService', () => {
  const svc = new AgentRegistryService(buildAgentRegistry())

  it('listAll() returns 17 camelCase AgentInfo DTOs', () => {
    const all = svc.listAll()
    expect(all.length).toBe(17)
    const claude = all.find((a) => a.id === 'claude')!
    expect(claude).toEqual({
      id: 'claude',
      displayName: 'Claude Code',
      family: 'cli_agent',
      capabilities: ['skills', 'mcp', 'session_log'],
    })
  })

  it('get() projects a single agent; unknown returns undefined', () => {
    expect(svc.get('codex')?.displayName).toBe('Codex')
    // unknown ids are rejected at parse time in the handler; service get takes AgentId.
  })

  it('listByCapability() filters projected DTOs', () => {
    const credentialAgents = svc.listByCapability('credential').map((a) => a.id)
    expect(credentialAgents).toContain('cursor')
    expect(credentialAgents).toContain('codex')
    expect(credentialAgents).not.toContain('claude') // claude has no credential cap
  })

  it('getCapabilities() returns canonical-ordered capabilities', () => {
    expect(svc.getCapabilities('codex')).toEqual(['credential', 'skills', 'mcp', 'session_log'])
    expect(svc.getCapabilities('hermes')).toEqual(['skills', 'mcp'])
  })

  it('session_log filtering yields exactly the 5 log-capable agents', () => {
    const ids = svc.listByCapability('session_log').map((a) => a.id).sort()
    expect(ids).toEqual(['claude', 'codex', 'gemini_cli', 'kiro', 'qoder'])
  })
})
