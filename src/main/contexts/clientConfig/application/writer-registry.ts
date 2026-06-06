// 写入器注册表：按 clientId 持有 ClientConfigWriter（container 用 path-resolver 解析路径后注册）。
// 新增客户端 = 注册一个 writer，主链路（service）零改动。
import type { ClientId } from '../domain/client-profile'
import type { ClientConfigWriter } from '../domain/client-writer'

export class WriterRegistry {
  private readonly writers = new Map<ClientId, ClientConfigWriter>()

  register(writer: ClientConfigWriter): void {
    this.writers.set(writer.clientId, writer)
  }

  get(clientId: ClientId): ClientConfigWriter | undefined {
    return this.writers.get(clientId)
  }

  has(clientId: ClientId): boolean {
    return this.writers.has(clientId)
  }

  clientIds(): ClientId[] {
    return [...this.writers.keys()]
  }
}
