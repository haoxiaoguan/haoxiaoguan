import { ipcMain } from 'electron'
import { toIpcError } from '../../../ipc/error'
import { parsePlatform } from '../../account/domain/platform-id'
import { CREDENTIAL_CHANNELS } from './credential-channels'
import {
  importedMaterialToJson,
  oauthPendingToJson,
  parseOAuthMode,
  validationResultToJson,
  type ImportedCredentialMaterialJson,
  type OAuthPendingJson,
} from '../domain/capability-types'
import type { OAuthService } from '../application/oauth-service'
import type { ImportService } from '../application/import-service'
import type { ValidationService } from '../application/validation-service'
import type { ProxyResolver } from '../../proxy/infrastructure/proxy-resolver'
import { runWithDispatcher } from '../../../platform/net/dispatcher-context'

// registerCredentialHandlers — wires the 7 credential IPC channels.
//
// Arg/return shapes are fixed by the frontend contract (map_frontend_ipc.md
// credentialService + healthService). Top-level args are camelCase
// (provider, mode, pendingId, code, payload, url, accountId, accountIds,
// concurrency). Returns are snake_case (pending_id, access_token, checked_at,
// account_id) — the *ToJson helpers produce the exact wire shapes. state and
// code_verifier are stripped from OAuthPending. Every handler wraps thrown errors
// with toIpcError so the rejection is a plain string.

export interface CredentialServices {
  oauthService: OAuthService
  importService: ImportService
  validationService: ValidationService
  /** Optional: when present, import handlers route enrichment requests through the selected proxy. */
  proxyResolver?: ProxyResolver
}

export function registerCredentialHandlers(services: CredentialServices): void {
  const { oauthService, importService, validationService, proxyResolver } = services

  // start_oauth — { provider, mode } → OAuthPending (state/code_verifier stripped)
  ipcMain.handle(
    CREDENTIAL_CHANNELS.startOauth,
    async (_e, args: { provider: string; mode: string }): Promise<OAuthPendingJson> => {
      try {
        const provider = parsePlatform(args.provider)
        const mode = parseOAuthMode(args.mode)
        const pending = await oauthService.start(provider, mode)
        return oauthPendingToJson(pending)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // complete_oauth — { pendingId, code } → ImportedCredentialMaterial
  ipcMain.handle(
    CREDENTIAL_CHANNELS.completeOauth,
    async (_e, args: { pendingId: string; code: string }): Promise<ImportedCredentialMaterialJson> => {
      try {
        const material = await oauthService.complete(args.pendingId, args.code ?? '')
        return importedMaterialToJson(material)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // import_token_json — { provider, payload, proxyId? } → ImportedCredentialMaterial
  ipcMain.handle(
    CREDENTIAL_CHANNELS.importTokenJson,
    async (_e, args: { provider: string; payload: string; proxyId?: string }): Promise<ImportedCredentialMaterialJson> => {
      try {
        const provider = parsePlatform(args.provider)
        const dispatcher =
          args.proxyId !== undefined && args.proxyId !== '' && proxyResolver !== undefined
            ? await proxyResolver.dispatcherForProxyId(args.proxyId)
            : undefined
        const material = await runWithDispatcher(dispatcher, () =>
          importService.importFromJson(provider, args.payload),
        )
        return importedMaterialToJson(material)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // scan_local_credentials — { provider, proxyId? } → ImportedCredentialMaterial[]
  ipcMain.handle(
    CREDENTIAL_CHANNELS.scanLocalCredentials,
    async (_e, args: { provider: string; proxyId?: string }): Promise<ImportedCredentialMaterialJson[]> => {
      try {
        const provider = parsePlatform(args.provider)
        const dispatcher =
          args.proxyId !== undefined && args.proxyId !== '' && proxyResolver !== undefined
            ? await proxyResolver.dispatcherForProxyId(args.proxyId)
            : undefined
        const materials = await runWithDispatcher(dispatcher, () => importService.scanLocal(provider))
        return materials.map(importedMaterialToJson)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // import_deeplink — { provider, url, proxyId? } → ImportedCredentialMaterial
  ipcMain.handle(
    CREDENTIAL_CHANNELS.importDeeplink,
    async (_e, args: { provider: string; url: string; proxyId?: string }): Promise<ImportedCredentialMaterialJson> => {
      try {
        const provider = parsePlatform(args.provider)
        const dispatcher =
          args.proxyId !== undefined && args.proxyId !== '' && proxyResolver !== undefined
            ? await proxyResolver.dispatcherForProxyId(args.proxyId)
            : undefined
        const material = await runWithDispatcher(dispatcher, () =>
          importService.importFromDeeplink(provider, args.url),
        )
        return importedMaterialToJson(material)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // validate_credential — { accountId } → CredentialValidationResult (snake_case)
  ipcMain.handle(
    CREDENTIAL_CHANNELS.validateCredential,
    async (_e, args: { accountId: string }) => {
      try {
        const result = await validationService.validate(args.accountId)
        return validationResultToJson(result)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // validate_batch — { accountIds, concurrency? } →
  //   Array<{account_id, result} | {account_id, error}>  (snake_case)
  ipcMain.handle(
    CREDENTIAL_CHANNELS.validateBatch,
    async (_e, args: { accountIds: string[]; concurrency?: number }) => {
      try {
        const items = await validationService.validateBatch(args.accountIds, args.concurrency ?? 4)
        return items.map((item) =>
          item.error !== undefined
            ? { account_id: item.accountId, error: item.error }
            : { account_id: item.accountId, result: validationResultToJson(item.result!) },
        )
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )
}
