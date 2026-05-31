import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  injectCredentialToStorageJson,
  injectCredentialToJsonFile,
  injectCredentialToHostsJson,
} from '../../../src/main/agents/infrastructure/shared/credential-io'
import { FileCredentialInjection } from '../../../src/main/agents/infrastructure/shared/credential-injection-base'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agents-cred-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('credential-io injection formats', () => {
  it('storage.json: writes storage.serviceMachineId and preserves other keys', async () => {
    const path = join(dir, 'nested', 'storage.json')
    mkdirSync(join(dir, 'nested'), { recursive: true })
    writeFileSync(path, JSON.stringify({ 'other.key': 'keepme' }))

    await injectCredentialToStorageJson('tok-123', path)

    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    expect(parsed['storage.serviceMachineId']).toBe('tok-123')
    expect(parsed['other.key']).toBe('keepme') // not clobbered
  })

  it('storage.json: tolerates a corrupt existing file by starting fresh', async () => {
    const path = join(dir, 'storage.json')
    writeFileSync(path, '{ this is : not json')
    await injectCredentialToStorageJson('tok', path)
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    expect(parsed['storage.serviceMachineId']).toBe('tok')
  })

  it('storage.json: creates parent dirs when absent', async () => {
    const path = join(dir, 'a', 'b', 'storage.json')
    await injectCredentialToStorageJson('tok', path)
    expect(existsSync(path)).toBe(true)
  })

  it('token json: writes {"token": ...}', async () => {
    const path = join(dir, 'auth.json')
    await injectCredentialToJsonFile('secret', path)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ token: 'secret' })
  })

  it('hosts.json: writes github.com.oauth_token', async () => {
    const path = join(dir, 'hosts.json')
    await injectCredentialToHostsJson('gho_xxx', path)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      'github.com': { oauth_token: 'gho_xxx' },
    })
  })
})

describe('FileCredentialInjection', () => {
  it('inject then clear removes the file; clear is a no-op when absent', async () => {
    const path = join(dir, 'creds.json')
    const ci = new FileCredentialInjection(path, 'token_json')
    expect(ci.credentialPath()).toBe(path)

    await ci.inject({ token: 'abc' })
    expect(existsSync(path)).toBe(true)

    await ci.clear()
    expect(existsSync(path)).toBe(false)

    // no-op when already gone
    await expect(ci.clear()).resolves.toBeUndefined()
  })

  it('extract returns null (read-back not implemented, matches source)', async () => {
    const ci = new FileCredentialInjection(join(dir, 'x.json'), 'token_json')
    await expect(ci.extract()).resolves.toBeNull()
  })

  it('storage_json format injects the VSCode-family key', async () => {
    const path = join(dir, 'storage.json')
    const ci = new FileCredentialInjection(path, 'storage_json')
    await ci.inject({ token: 'machine-id' })
    expect(JSON.parse(readFileSync(path, 'utf8'))['storage.serviceMachineId']).toBe('machine-id')
  })

  it('hosts_json format injects the copilot host entry', async () => {
    const path = join(dir, 'hosts.json')
    const ci = new FileCredentialInjection(path, 'hosts_json')
    await ci.inject({ token: 'gho' })
    expect(JSON.parse(readFileSync(path, 'utf8'))['github.com'].oauth_token).toBe('gho')
  })
})
