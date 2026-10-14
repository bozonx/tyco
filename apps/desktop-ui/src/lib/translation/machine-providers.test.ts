import { DEFAULT_USER_CONFIG } from '@tyco/shared'
import { expect, it, vi } from 'vitest'
import { createDeepLProvider } from './machine-providers'
import { createTranslationClient } from './translation-client'

it('classifies a depleted DeepL subscription as a permanent failure', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response('{"message":"Quota exceeded"}', { status: 456 })
    )
  const provider = createDeepLProvider({ apiKey: 'reference', fetch })
  await expect(
    provider.translate({
      modelId: 'quality_optimized',
      texts: ['Hello'],
      targetLanguage: 'ru',
      signal: new AbortController().signal,
    })
  ).rejects.toMatchObject({
    kind: 'invalid_request',
    retryable: false,
    status: 456,
  })
})

it('does not retry a depleted subscription through ai-kit', async () => {
  const fetch = vi
    .fn()
    .mockImplementation(
      async () => new Response('{"message":"Quota exceeded"}', { status: 456 })
    )
  const client = createTranslationClient({
    getConfig: () => ({
      ...DEFAULT_USER_CONFIG.translation,
      provider: 'deepl',
      qualityGate: 'off',
      deeplEndpoint: 'free',
      glossary: [],
      correctionPrompt: '',
    }),
    keys: { get: async () => 'reference' },
    transport: { fetch, openSocket: vi.fn() },
    runLlm: vi.fn(),
  })
  await expect(
    client.translate('Hello', { targetLanguage: 'ru' })
  ).rejects.toThrow('quota is exhausted')
  expect(fetch).toHaveBeenCalledOnce()
})
