import type { FetchFunction } from '@bozonx/ai-kit'
import type { LlmProvider } from '@tyco/shared'

import { secretRef } from '../net/secrets'

export class InvalidLlmBaseUrlError extends Error {}

export function createLlmConnectionChecker(options: {
  fetch: FetchFunction
  hasKey: (providerId: string) => boolean
  getModelId?: (providerId: string) => string | undefined
  timeoutMs?: number
}) {
  return async (provider: LlmProvider): Promise<void> => {
    const baseUrl = normalizeHttpUrl(provider.baseUrl)
    if (!baseUrl) throw new InvalidLlmBaseUrlError('Invalid LLM base URL')
    const signal = AbortSignal.timeout(options.timeoutMs ?? 15_000)
    const headers = options.hasKey(provider.id)
      ? { Authorization: `Bearer ${secretRef(provider.id)}` }
      : undefined
    const response = await options.fetch(`${baseUrl}/models`, {
      headers,
      signal,
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`HTTP ${response.status}`)
    }
    const payload: unknown = await response.json()
    if (
      !payload ||
      typeof payload !== 'object' ||
      !Array.isArray((payload as { data?: unknown }).data)
    ) {
      throw new Error(
        'The server did not return an OpenAI-compatible model list'
      )
    }
    const modelId = options.getModelId?.(provider.id)?.trim()
    if (!modelId) return
    const generated = await options.fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        max_tokens: 8,
        stream: false,
      }),
      signal,
    })
    if (!generated.ok) {
      await generated.body?.cancel()
      throw new Error(`Model ${modelId}: HTTP ${generated.status}`)
    }
    const result = (await generated.json()) as {
      choices?: { message?: { content?: unknown }; finish_reason?: string }[]
    }
    if (
      !result.choices?.some(
        (choice) =>
          typeof choice.message?.content === 'string' &&
          choice.message.content.trim()
      )
    ) {
      throw new Error(`Model ${modelId} did not produce a text response`)
    }
  }
}

function normalizeHttpUrl(value: string | undefined): string | null {
  try {
    const url = new URL(value?.trim() ?? '')
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password || url.search || url.hash) return null
    return url.href.replace(/\/$/, '')
  } catch {
    return null
  }
}
