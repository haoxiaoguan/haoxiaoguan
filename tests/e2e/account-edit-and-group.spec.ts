import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// End-to-end exercise of the account-edit + account-group features against the
// real Electron app, real IPC, and real SQLite.
//
// Flow:
//   1. Import a kiro account (token_json) → AccountResponse
//   2. updateAccount: change name + tags + notes; assert AccountResponse reflects edits
//   3. reauthenticate with a MISMATCHED identifier → expect rejection (security guard)
//   4. accountGroup.createGroup, addMembers, listGroupsForAccount round-trip
//   5. proxy.createProxy + accountGroup.bindGroupToProxy → assert getGroupBinding
//      returns the binding
//   6. accountGroup.deleteGroup with members but no force → reject; with force → succeed
//
// Isolated via HXG_USER_DATA_DIR so each run uses a fresh DB + master key.

let app: ElectronApplication
let userDataDir: string | null = null

test.afterEach(async () => {
  if (app) await app.close()
  if (userDataDir) {
    rmSync(userDataDir, { recursive: true, force: true })
    userDataDir = null
  }
})

test('account edit, group management, and group→proxy binding round-trip end-to-end', async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'hxg-acct-grp-'))
  app = await electron.launch({
    args: ['out/main/main.cjs'],
    env: { ...process.env, HXG_USER_DATA_DIR: userDataDir },
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  const tokenJson = JSON.stringify({
    access_token: 'kiro_at_test',
    refresh_token: 'kiro_rt_test',
    expires_at: '2099-01-01T00:00:00Z',
    profile: { email: 'edit-target@example.com' },
  })

  // 1. Import a kiro account via the credential token_json import.
  const account = await window.evaluate(async (payload: string) => {
    type Api = {
      credential: {
        importTokenJson(provider: string, payload: string): Promise<{
          provider: string
          email: string
          access_token: string
          refresh_token?: string
          expires_at?: string
          raw_metadata?: unknown
        }>
      }
      account: {
        importAccount(req: {
          platform: string
          email: string
          token: string
          refreshToken?: string
          expiresAt?: string
          rawMetadata?: unknown
          tags: string[]
        }): Promise<{ id: string; identityKey: string; name?: string; tags: string[] }>
      }
    }
    const api = (window as unknown as { api: Api }).api
    const material = await api.credential.importTokenJson('kiro', payload)
    return api.account.importAccount({
      platform: material.provider,
      email: material.email,
      token: material.access_token,
      refreshToken: material.refresh_token,
      expiresAt: material.expires_at,
      rawMetadata: material.raw_metadata,
      tags: [],
    })
  }, tokenJson)
  expect(account.id).toBeTruthy()
  expect(account.tags).toEqual([])

  // 2. updateAccount: change name + tags + notes
  const edited = await window.evaluate(async (accountId: string) => {
    type Api = {
      account: {
        updateAccount(
          accountId: string,
          patch: { name?: string | null; tags?: string[]; notes?: string | null },
        ): Promise<{ name?: string; tags: string[]; notes?: string }>
      }
    }
    return (window as unknown as { api: Api }).api.account.updateAccount(accountId, {
      name: 'Edited Alice',
      tags: ['prod', 'cn'],
      notes: 'updated via e2e',
    })
  }, account.id)
  expect(edited.name).toBe('Edited Alice')
  expect(edited.tags).toEqual(['prod', 'cn'])
  expect(edited.notes).toBe('updated via e2e')

  // 3. Identity-mismatch re-auth must REJECT.
  const reauthError = await window.evaluate(async (accountId: string) => {
    type Api = {
      account: {
        reauthenticate(
          accountId: string,
          input: { identifier: string; token: string },
        ): Promise<unknown>
      }
    }
    try {
      await (window as unknown as { api: Api }).api.account.reauthenticate(accountId, {
        identifier: 'someone-else@example.com',
        token: 'attacker_token',
      })
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }, account.id)
  expect(reauthError).toMatch(/identity mismatch/i)

  // 4. accountGroup CRUD + membership round-trip
  const groupFlow = await window.evaluate(async (accountId: string) => {
    type Api = {
      accountGroup: {
        createGroup(req: { name: string; color?: string; description?: string }): Promise<{
          id: string
          name: string
          color?: string
          memberCount: number
        }>
        addMembers(groupId: string, accountIds: string[]): Promise<{ added: number }>
        listGroupsForAccount(
          accountId: string,
        ): Promise<Array<{ id: string; name: string; memberCount: number }>>
        listGroups(): Promise<Array<{ id: string; memberCount: number }>>
      }
    }
    const api = (window as unknown as { api: Api }).api
    const created = await api.accountGroup.createGroup({
      name: '客户 A',
      color: '#0EA5E9',
      description: 'cross-platform group',
    })
    const addRes = await api.accountGroup.addMembers(created.id, [accountId])
    const forAcc = await api.accountGroup.listGroupsForAccount(accountId)
    const list = await api.accountGroup.listGroups()
    return { created, addRes, forAcc, list }
  }, account.id)
  expect(groupFlow.created.color).toBe('#0ea5e9')
  expect(groupFlow.addRes.added).toBe(1)
  expect(groupFlow.forAcc).toHaveLength(1)
  expect(groupFlow.forAcc[0].id).toBe(groupFlow.created.id)
  expect(groupFlow.list[0].memberCount).toBe(1)

  // 5. Proxy + group→proxy binding
  const bindFlow = await window.evaluate(async (groupId: string) => {
    type Api = {
      proxy: {
        createProxy(req: {
          protocol: 'http' | 'https' | 'socks5'
          host: string
          port: number
          tags?: string[]
        }): Promise<{ id: string }>
      }
      accountGroup: {
        bindGroupToProxy(groupId: string, proxyId: string): Promise<{ proxyId?: string }>
        getGroupBinding(groupId: string): Promise<{ proxyId?: string } | null>
      }
    }
    const api = (window as unknown as { api: Api }).api
    const proxy = await api.proxy.createProxy({
      protocol: 'http',
      host: '203.0.113.7',
      port: 8080,
      tags: [],
    })
    await api.accountGroup.bindGroupToProxy(groupId, proxy.id)
    const binding = await api.accountGroup.getGroupBinding(groupId)
    return { proxyId: proxy.id, binding }
  }, groupFlow.created.id)
  expect(bindFlow.binding?.proxyId).toBe(bindFlow.proxyId)

  // 6. Delete protection: with a member, force=false rejects; force=true succeeds.
  const deleteResult = await window.evaluate(async (groupId: string) => {
    type Api = {
      accountGroup: {
        deleteGroup(id: string, force?: boolean): Promise<void>
      }
    }
    const api = (window as unknown as { api: Api }).api
    let unforcedError: string | null = null
    try {
      await api.accountGroup.deleteGroup(groupId, false)
    } catch (e) {
      unforcedError = e instanceof Error ? e.message : String(e)
    }
    let forcedOk = false
    try {
      await api.accountGroup.deleteGroup(groupId, true)
      forcedOk = true
    } catch {
      forcedOk = false
    }
    return { unforcedError, forcedOk }
  }, groupFlow.created.id)
  expect(deleteResult.unforcedError).toBeTruthy()
  expect(deleteResult.forcedOk).toBe(true)
})

test('account proxy binding + single-group invariant round-trip end-to-end', async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'hxg-acct-bind-'))
  app = await electron.launch({
    args: ['out/main/main.cjs'],
    env: { ...process.env, HXG_USER_DATA_DIR: userDataDir },
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  const result = await window.evaluate(async () => {
    type Api = {
      credential: {
        importTokenJson(provider: string, payload: string): Promise<{
          provider: string
          email: string
          access_token: string
          refresh_token?: string
          expires_at?: string
          raw_metadata?: unknown
        }>
      }
      account: {
        importAccount(req: {
          platform: string
          email: string
          token: string
          refreshToken?: string
          expiresAt?: string
          rawMetadata?: unknown
          tags: string[]
        }): Promise<{ id: string }>
      }
      proxy: {
        createProxy(req: {
          protocol: 'http' | 'https' | 'socks5'
          host: string
          port: number
          tags?: string[]
        }): Promise<{ id: string }>
        bindAccountToProxy(accountId: string, proxyId: string): Promise<void>
        getAccountBinding(accountId: string): Promise<{ proxyId?: string } | null>
        unbindAccount(accountId: string): Promise<void>
      }
      accountGroup: {
        createGroup(req: { name: string }): Promise<{ id: string }>
        addMembers(groupId: string, accountIds: string[]): Promise<{ added: number }>
        listGroupsForAccount(accountId: string): Promise<Array<{ id: string }>>
      }
    }
    const api = (window as unknown as { api: Api }).api

    const material = await api.credential.importTokenJson(
      'kiro',
      JSON.stringify({ access_token: 't', profile: { email: 'bind@example.com' } }),
    )
    const account = await api.account.importAccount({
      platform: material.provider,
      email: material.email,
      token: material.access_token,
      tags: [],
    })

    // Bind the account directly to a proxy, read back, then unbind.
    const proxy = await api.proxy.createProxy({ protocol: 'http', host: '203.0.113.9', port: 8080, tags: [] })
    await api.proxy.bindAccountToProxy(account.id, proxy.id)
    const boundProxyId = (await api.proxy.getAccountBinding(account.id))?.proxyId
    await api.proxy.unbindAccount(account.id)
    const afterUnbind = await api.proxy.getAccountBinding(account.id)

    // Single-group invariant: join A, then join B → only B remains.
    const a = await api.accountGroup.createGroup({ name: 'A' })
    const b = await api.accountGroup.createGroup({ name: 'B' })
    await api.accountGroup.addMembers(a.id, [account.id])
    await api.accountGroup.addMembers(b.id, [account.id])
    const groups = await api.accountGroup.listGroupsForAccount(account.id)

    return {
      boundProxyId,
      proxyId: proxy.id,
      afterUnbind,
      groupIds: groups.map((g) => g.id),
      bId: b.id,
    }
  })

  expect(result.boundProxyId).toBe(result.proxyId)
  expect(result.afterUnbind).toBeNull()
  // Only group B remains (joining B evicted the account from A).
  expect(result.groupIds).toEqual([result.bId])
})

test('the 分组管理 page mounts via the nav route and creates a group through the wizard', async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'hxg-groups-ui-'))
  app = await electron.launch({
    args: ['out/main/main.cjs'],
    env: { ...process.env, HXG_USER_DATA_DIR: userDataDir },
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  // Navigate to the dedicated Groups page via its hash route.
  await window.evaluate(() => {
    window.location.hash = '#/accounts/groups'
  })

  // Empty state: the table shows the "no groups" row.
  await expect(window.getByText(/No groups yet|还没有分组/).first()).toBeVisible()

  // Open the wizard via the toolbar "New group" action.
  await window.getByRole('button', { name: /^New group$|^新建分组$/ }).first().click()

  const dialog = window.getByRole('dialog')
  await expect(dialog).toBeVisible()

  // Step 1 — basics: fill the name (the first textbox in the dialog).
  await dialog.getByRole('textbox').first().fill('UI Wizard Group')
  await dialog.getByRole('button', { name: /^Next$|^下一步$/ }).click()

  // Step 2 — members: skip selection (allowed), advance.
  await dialog.getByRole('button', { name: /^Next$|^下一步$/ }).click()

  // Step 3 — proxy: leave on "none", finish.
  await dialog.getByRole('button', { name: /^Finish$|^完成$/ }).click()

  // The new group appears as a table row.
  await expect(window.getByText('UI Wizard Group').first()).toBeVisible()

  // Verify it persisted through IPC.
  const persisted = await window.evaluate(async () => {
    const api = (window as unknown as {
      api: { accountGroup: { listGroups(): Promise<Array<{ name: string }>> } }
    }).api
    return api.accountGroup.listGroups()
  })
  expect(persisted.some((g) => g.name === 'UI Wizard Group')).toBe(true)
})

