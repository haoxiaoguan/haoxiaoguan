// McpServerRepository — domain port (interface).
// Implemented in infrastructure by MikroOrmMcpServerRepository.

import type { McpServer } from './mcp-server'

export interface McpServerRepository {
  findAll(): Promise<McpServer[]>
  findById(id: string): Promise<McpServer | null>
  save(server: McpServer): Promise<void>
  delete(id: string): Promise<void>
}
