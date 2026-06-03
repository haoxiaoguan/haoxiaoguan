import { generateClientKey } from '../domain/client-key-gen'
import type { ApiProxyKeyMeta, ApiProxyKeyRepository } from '../infrastructure/api-proxy-key.repository'

/** Key 管理 application：生成明文 → repo 加密落库，明文仅 create 返回值回显一次。 */
export class ApiProxyKeyService {
  constructor(private readonly repo: ApiProxyKeyRepository) {}

  async create(name: string): Promise<{ meta: ApiProxyKeyMeta; plaintext: string }> {
    const plaintext = generateClientKey()
    const meta = await this.repo.create(name, plaintext)
    return { meta, plaintext }
  }
  list(): Promise<ApiProxyKeyMeta[]> { return this.repo.listMeta() }
  setActive(id: string, isActive: boolean): Promise<void> { return this.repo.setActive(id, isActive) }
  delete(id: string): Promise<void> { return this.repo.delete(id) }
}
