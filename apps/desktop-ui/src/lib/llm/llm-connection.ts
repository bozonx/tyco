import type { FetchFunction } from '@bozonx/ai-kit'
import type { LlmProvider } from '@tyco/shared'

import { secretRef } from '../net/secrets'

export class InvalidLlmBaseUrlError extends Error {}

export function createLlmConnectionChecker(options: {
  fetch: FetchFunction
  hasKey: (providerId: string) => boolean
}) {
  return async (provider: LlmProvider): Promise<void> => {
    const baseUrl = normalizeHttpUrl(provider.baseUrl)
    if (!baseUrl) throw new InvalidLlmBaseUrlError('Invalid LLM base URL')

    const headers = options.hasKey(provider.id)
      ? { Authorization: `Bearer ${secretRef(provider.id)}` }
      : undefined
    const response = await options.fetch(`${baseUrl}/models`, { headers })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    await response.body?.cancel()
  }
}

function normalizeHttpUrl(value: string | undefined): string | null {
  try {
    const url = new URL(value?.trim() ?? '')
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.href.replace(/\/$/, '')
  } catch {
    return null
  }
}
