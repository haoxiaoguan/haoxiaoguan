import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm as defaultGetEm } from '../../../platform/persistence/database'
import { platformFromAgentIdOrCursor, platformToAgentId } from '../../account/domain/platform-id'
import { CredentialError } from '../domain/credential-error'
import type { PendingImport, PendingImportRepository } from '../domain/pending-repository'

// MikroORM-backed PendingImportRepository. 对应 sea-orm
// PendingImportRepository: upsert-on-conflict by id, purge by expires_at < now.

interface PendingImportRow {
  id: string
  provider: string
  payload_json: string
  created_at: string
  expires_at: string
}

function rowToDomain(row: PendingImportRow): PendingImport {
  return {
    id: row.id,
    provider: platformFromAgentIdOrCursor(row.provider),
    payloadJson: row.payload_json,
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
  }
}

export class MikroOrmPendingImportRepository implements PendingImportRepository {
  private readonly getEm: () => EntityManager

  constructor(getEmFn?: () => EntityManager) {
    this.getEm = getEmFn ?? defaultGetEm
  }

  async save(pending: PendingImport): Promise<void> {
    try {
      const conn = this.getEm().getConnection()
      await conn.execute(
        `INSERT INTO pending_import (id, provider, payload_json, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           provider = excluded.provider,
           payload_json = excluded.payload_json,
           expires_at = excluded.expires_at`,
        [
          pending.id,
          platformToAgentId(pending.provider),
          pending.payloadJson,
          pending.createdAt.toISOString(),
          pending.expiresAt.toISOString(),
        ],
      )
    } catch (e) {
      throw CredentialError.storageError(
        `pending import save: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  async findById(id: string): Promise<PendingImport | null> {
    try {
      const conn = this.getEm().getConnection()
      const rows = (await conn.execute('SELECT * FROM pending_import WHERE id = ?', [
        id,
      ])) as PendingImportRow[]
      const row = rows[0]
      return row ? rowToDomain(row) : null
    } catch (e) {
      throw CredentialError.storageError(
        `pending import find: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const conn = this.getEm().getConnection()
      await conn.execute('DELETE FROM pending_import WHERE id = ?', [id])
    } catch (e) {
      throw CredentialError.storageError(
        `pending import delete: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  async purgeExpired(now: Date): Promise<number> {
    try {
      const conn = this.getEm().getConnection()
      const before = (await conn.execute(
        'SELECT COUNT(*) AS n FROM pending_import WHERE expires_at < ?',
        [now.toISOString()],
      )) as Array<{ n: number }>
      await conn.execute('DELETE FROM pending_import WHERE expires_at < ?', [now.toISOString()])
      return Number(before[0]?.n ?? 0)
    } catch (e) {
      throw CredentialError.storageError(
        `pending import purge: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }
}
