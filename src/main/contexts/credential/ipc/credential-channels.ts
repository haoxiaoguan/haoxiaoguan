// Credential IPC channel constants.
//
// Single source of truth lives in src/shared/ipc-channels.ts (wired by the
// integration plan — see the credential manifest §3). This file re-exports it,
// mirroring contexts/account/ipc/account-channels.ts.

export { CREDENTIAL_CHANNELS } from '../../../../shared/ipc-channels'
import { CREDENTIAL_CHANNELS } from '../../../../shared/ipc-channels'

export type CredentialChannel = (typeof CREDENTIAL_CHANNELS)[keyof typeof CREDENTIAL_CHANNELS]
