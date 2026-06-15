// AgentError — mirrors Rust agents::domain::error::AgentError (thiserror enum).
// Modeled as an Error subclass carrying a discriminant `kind` plus optional
// path/cause so callers can branch without string-matching the message.

import type { AgentId } from './agent-id'
import type { Capability } from './capability'

export type AgentErrorKind =
  | 'not_found'
  | 'does_not_support'
  | 'config_parse'
  | 'config_write'
  | 'filesystem'
  | 'symlink_unsupported'
  | 'validation'

export class AgentError extends Error {
  readonly kind: AgentErrorKind
  readonly path?: string | undefined
  override readonly cause?: unknown

  private constructor(kind: AgentErrorKind, message: string, path?: string, cause?: unknown) {
    super(message)
    this.name = 'AgentError'
    this.kind = kind
    this.path = path
    this.cause = cause
  }

  static notFound(id: AgentId): AgentError {
    return new AgentError('not_found', `agent ${id} not found in registry`)
  }

  static doesNotSupport(id: AgentId, cap: Capability): AgentError {
    return new AgentError('does_not_support', `agent ${id} does not support capability ${cap}`)
  }

  static configParse(path: string, reason: string): AgentError {
    return new AgentError('config_parse', `config file at ${path} could not be parsed: ${reason}`, path)
  }

  static configWrite(path: string, cause: unknown): AgentError {
    return new AgentError(
      'config_write',
      `config file at ${path} could not be written: ${errText(cause)}`,
      path,
      cause,
    )
  }

  static filesystem(path: string, cause: unknown): AgentError {
    return new AgentError('filesystem', `filesystem error at ${path}: ${errText(cause)}`, path, cause)
  }

  static symlinkUnsupported(detail: string): AgentError {
    return new AgentError(
      'symlink_unsupported',
      `symlink unsupported on this platform, fallback failed: ${detail}`,
    )
  }

  static validation(detail: string): AgentError {
    return new AgentError('validation', `validation failed: ${detail}`)
  }
}

function errText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
