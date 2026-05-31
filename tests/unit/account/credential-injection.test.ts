import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  injectCredentialToStorageJson,
  injectCredentialToJsonFile,
  injectCredentialToHostsJson,
  clearCredentialFile,
} from '../../../src/main/agents/credential-injection/credential-io'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hxg-inject-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('credential-io injection formats', () => {
  it('storage.json merges storage.serviceMachineId, preserving existing keys', () => {
    const path = join(dir, 'storage.json')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path, JSON.stringify({ 'existing.key': 'keep' }), 'utf8')
    return injectCredentialToStorageJson('TOKEN123', path).then(() => {
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      expect(parsed['storage.serviceMachineId']).toBe('TOKEN123')
      expect(parsed['existing.key']).toBe('keep')
    })
  })

  it('storage.json creates the file (and parent) when absent', async () => {
    const path = join(dir, 'nested', 'globalStorage', 'storage.json')
    await injectCredentialToStorageJson('T', path)
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    expect(parsed['storage.serviceMachineId']).toBe('T')
  })

  it('json file writes {"token": ...}', async () => {
    const path = join(dir, 'auth.json')
    await injectCredentialToJsonFile('TK', path)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ token: 'TK' })
  })

  it('hosts.json writes github.com.oauth_token', async () => {
    const path = join(dir, 'hosts.json')
    await injectCredentialToHostsJson('OAUTH', path)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ 'github.com': { oauth_token: 'OAUTH' } })
  })

  it('clear removes the file', async () => {
    const path = join(dir, 'creds.json')
    await injectCredentialToJsonFile('x', path)
    expect(existsSync(path)).toBe(true)
    await clearCredentialFile(path)
    expect(existsSync(path)).toBe(false)
    // clearing a missing file is a no-op.
    await clearCredentialFile(path)
  })
})
