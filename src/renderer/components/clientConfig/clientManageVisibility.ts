import type { ClientConfigClientInfo } from '@shared/api-types'

export function clientManageVisibleClients(clients: ClientConfigClientInfo[]): ClientConfigClientInfo[] {
  return clients.filter((client) => client.clientId !== 'claude_desktop')
}
