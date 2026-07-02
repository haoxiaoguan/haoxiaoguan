// HttpLiveQuotaFetcher — dispatches a live HTTP quota fetch per platform.
//
// All 11 desktop platforms have a live fetcher; only truly unsupported ids fall
// through to the Unsupported result. Each platform module handles its own token
// refresh inline.

import type { LiveQuotaFetcher, QuotaFetchRequest } from '../../domain/ports'
import { unsupportedFetchResult, type QuotaFetchResult } from '../../domain/capabilities'
import * as cursor from './cursor'
import * as windsurf from './windsurf'
import * as kiro from './kiro'
import * as githubCopilot from './github-copilot'
import * as codex from './codex'
import * as gemini from './gemini'
import * as codebuddy from './codebuddy'
import * as qoder from './qoder'
import * as trae from './trae'
import * as zed from './zed'
import * as antigravity from './antigravity'

export class HttpLiveQuotaFetcher implements LiveQuotaFetcher {
  async fetch(request: QuotaFetchRequest): Promise<QuotaFetchResult> {
    const { platform, credential, profilePayload } = request
    switch (platform) {
      case 'cursor':
        return cursor.fetch(credential, profilePayload)
      case 'windsurf':
        return windsurf.fetch(credential, profilePayload)
      case 'kiro':
        return kiro.fetch(credential, profilePayload)
      case 'github_copilot':
        return githubCopilot.fetch(credential, profilePayload)
      case 'codex':
        return codex.fetch(credential, profilePayload)
      case 'gemini_cli':
        return gemini.fetch(credential, profilePayload)
      case 'codebuddy':
      case 'codebuddy_cn':
        return codebuddy.fetch(platform, credential, profilePayload)
      case 'qoder':
        return qoder.fetch(credential, profilePayload)
      case 'trae':
        return trae.fetch(credential, profilePayload)
      case 'zed':
        return zed.fetch(credential, profilePayload)
      case 'antigravity':
      case 'antigravity_ide':
        return antigravity.fetch(credential, profilePayload)
      default:
        return unsupportedFetchResult()
    }
  }
}
