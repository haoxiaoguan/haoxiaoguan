import { describe, expect, it } from 'vitest'
import { clientManageVisibleClients } from '../../../src/renderer/components/clientConfig/clientManageVisibility'
import type { ClientConfigClientInfo } from '../../../src/shared/api-types'

describe('clientManageVisibleClients', () => {
  it('客户端管理隐藏 Claude Desktop，只保留可安装/升级的 CLI 客户端', () => {
    const clients: ClientConfigClientInfo[] = [
      { clientId: 'claude', displayName: 'Claude Code', detected: true, writeMode: 'switch' },
      { clientId: 'claude_desktop', displayName: 'Claude Desktop', detected: true, writeMode: 'switch' },
      { clientId: 'codex', displayName: 'Codex', detected: true, writeMode: 'additive' },
    ]

    expect(clientManageVisibleClients(clients).map((client) => client.clientId)).toEqual(['claude', 'codex'])
  })
})
