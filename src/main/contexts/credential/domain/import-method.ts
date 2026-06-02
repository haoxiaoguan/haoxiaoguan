// Credential import method. Used only as error context (which import flow
// failed). Serialises snake_case; OAuth serialises as "oauth".

export type ImportMethod = 'oauth' | 'local_scan' | 'token_json' | 'deep_link'

export const IMPORT_METHODS: readonly ImportMethod[] = [
  'oauth',
  'local_scan',
  'token_json',
  'deep_link',
] as const
