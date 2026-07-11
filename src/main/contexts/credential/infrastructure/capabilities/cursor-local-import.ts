import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { PlatformId } from '../../../account/domain/platform-id'
import type { LocalImportCapability } from '../../domain/capabilities'
import type { ImportedCredentialMaterial } from '../../domain/capability-types'
import { dirname, join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { normalizeNonEmpty, readVscdbItem } from '../vscdb-reader'
import { stateVscdbPath } from '../scan-helpers'

/**
 * 读 Cursor globalStorage/storage.json（与 state.vscdb 同目录）的 telemetry.* 机器 ID。
 * cursor 反代 checksum 真实用的是这里的 telemetry.machineId（64 位 sha256）+ telemetry.macMachineId，
 * 而非 vscdb 的 storage.serviceMachineId（36 位 UUID）——2026-07 真机逆向核对。
 */
function readCursorTelemetry(dbPath: string): { machineId?: string; macMachineId?: string } {
  try {
    const p = join(dirname(dbPath), 'storage.json')
    if (!existsSync(p)) return {}
    const j = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>
    const machineId = typeof j['telemetry.machineId'] === 'string' ? (j['telemetry.machineId'] as string) : undefined
    const macMachineId =
      typeof j['telemetry.macMachineId'] === 'string' ? (j['telemetry.macMachineId'] as string) : undefined
    return {
      ...(machineId !== undefined ? { machineId } : {}),
      ...(macMachineId !== undefined ? { macMachineId } : {}),
    }
  } catch {
    return {}
  }
}

// Cursor local-scan capability. Reads cursorAuth/* keys from Cursor's
// state.vscdb. Requires accessToken + cachedEmail; returns [] otherwise.

const CURSOR_APP_DIR = 'Cursor'

export class CursorLocalImportCapability implements LocalImportCapability {
  constructor(private readonly stateDbPathOverride?: string) {}

  provider(): PlatformId {
    return 'cursor'
  }

  private resolveStateDbPath(): string {
    return this.stateDbPathOverride ?? stateVscdbPath(CURSOR_APP_DIR)
  }

  async scanLocal(): Promise<ImportedCredentialMaterial[]> {
    const dbPath = this.resolveStateDbPath()
    const accessToken = normalizeNonEmpty(readVscdbItem(dbPath, 'cursorAuth/accessToken'))
    if (!accessToken) return []
    const email = normalizeNonEmpty(readVscdbItem(dbPath, 'cursorAuth/cachedEmail'))
    if (!email) return []

    const refreshToken = normalizeNonEmpty(readVscdbItem(dbPath, 'cursorAuth/refreshToken'))
    const authId =
      normalizeNonEmpty(readVscdbItem(dbPath, 'cursorAuth/authId')) ??
      extractAuthIdFromAccessToken(accessToken)
    const membershipType = normalizeNonEmpty(
      readVscdbItem(dbPath, 'cursorAuth/stripeMembershipType'),
    )
    const subscriptionStatus = normalizeNonEmpty(
      readVscdbItem(dbPath, 'cursorAuth/stripeSubscriptionStatus'),
    )
    const signUpType = normalizeNonEmpty(readVscdbItem(dbPath, 'cursorAuth/cachedSignUpType'))
    // 反代 checksum 头需 machineId：优先 storage.json 的 telemetry.machineId（cursor 真实用值），
    // 回退 vscdb serviceMachineId（真机实测两者上游都接受，但真实值更像正规客户端）。
    const telemetry = readCursorTelemetry(dbPath)
    const serviceMachineId = normalizeNonEmpty(readVscdbItem(dbPath, 'storage.serviceMachineId'))
    const machineId = telemetry.machineId ?? serviceMachineId

    return [
      {
        provider: 'cursor',
        email,
        accessToken,
        refreshToken,
        expiresAt: undefined,
        source: 'local_scan',
        rawMetadata: buildCursorRawMetadata({
          email,
          accessToken,
          refreshToken,
          authId,
          membershipType,
          subscriptionStatus,
          signUpType,
          machineId,
          macMachineId: telemetry.macMachineId,
        }),
      },
    ]
  }
}

function extractAuthIdFromAccessToken(accessToken: string): string | undefined {
  const seg = accessToken.split('.')[1]
  if (!seg) return undefined
  try {
    const decoded = Buffer.from(seg, 'base64url').toString('utf8')
    const value = JSON.parse(decoded) as Record<string, unknown>
    const sub = value.sub
    return typeof sub === 'string' ? normalizeNonEmpty(sub) : undefined
  } catch {
    return undefined
  }
}

interface CursorMetaInput {
  email: string
  accessToken: string
  refreshToken?: string | undefined
  authId?: string | undefined
  membershipType?: string | undefined
  subscriptionStatus?: string | undefined
  signUpType?: string | undefined
  machineId?: string | undefined
  macMachineId?: string | undefined
}

function buildCursorRawMetadata(input: CursorMetaInput): JsonValue {
  const authRaw: Record<string, JsonValue> = {
    accessToken: input.accessToken,
    cachedEmail: input.email,
  }
  if (input.refreshToken) authRaw.refreshToken = input.refreshToken
  if (input.authId) authRaw.authId = input.authId
  if (input.membershipType) authRaw.stripeMembershipType = input.membershipType
  if (input.subscriptionStatus) authRaw.stripeSubscriptionStatus = input.subscriptionStatus
  if (input.signUpType) authRaw.cachedSignUpType = input.signUpType
  if (input.machineId) authRaw.serviceMachineId = input.machineId

  return {
    email: input.email,
    auth_id: input.authId ?? null,
    membership_type: input.membershipType ?? null,
    subscription_status: input.subscriptionStatus ?? null,
    sign_up_type: input.signUpType ?? null,
    // 反代 checksum 头用；CursorAdapter.resolveCursorField 从此读取（telemetry_machine_id 优先）。
    telemetry_machine_id: input.machineId ?? null,
    service_machine_id: input.machineId ?? null,
    mac_machine_id: input.macMachineId ?? null,
    cursor_auth_raw: authRaw,
  }
}
