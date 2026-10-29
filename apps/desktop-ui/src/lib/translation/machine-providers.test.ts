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
      providers: { deepl: { endpoint: 'free' } },
      glossary: [],
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

it.each(['es-419', 'fr-CA', 'de-CH', 'pt-PT', 'zh-Hant'])(
  'preserves the DeepL target variant %s on the wire',
  async (targetLanguage) => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ translations: [{ text: 'Translated' }] }))
    )
    const client = createTranslationClient({
      getConfig: () => ({
        ...DEFAULT_USER_CONFIG.translation,
        provider: 'deepl',
      }),
      keys: { get: async () => 'reference' },
      transport: { fetch, openSocket: vi.fn() },
      runLlm: vi.fn(),
    })
    await client.translate('Hello', { targetLanguage, sourceLanguage: 'en-US' })
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      target_lang: targetLanguage.toUpperCase(),
      source_lang: 'EN',
    })
  }
)

it.each(['zh-TW', 'fr-CA', 'pa-Arab', 'pt-PT'])(
  'preserves the Google target variant %s on the wire',
  async (targetLanguage) => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          JSON.stringify({
            data: { translations: [{ translatedText: 'Translated' }] },
          })
        )
    )
    const client = createTranslationClient({
      getConfig: () => ({
        ...DEFAULT_USER_CONFIG.translation,
        provider: 'google',
      }),
      keys: { get: async () => 'reference' },
      transport: { fetch, openSocket: vi.fn() },
      runLlm: vi.fn(),
    })
    await client.translate('Hello', { targetLanguage, sourceLanguage: 'en-US' })
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      target: targetLanguage,
      source: 'en',
    })
  }
)

it('rejects unsupported machine languages before making a paid request', async () => {
  const fetch = vi.fn()
  const client = createTranslationClient({
    getConfig: () => ({
      ...DEFAULT_USER_CONFIG.translation,
      provider: 'deepl',
    }),
    keys: { get: async () => 'reference' },
    transport: { fetch, openSocket: vi.fn() },
    runLlm: vi.fn(),
  })
  await expect(
    client.translate('Hello', { targetLanguage: 'sah' })
  ).rejects.toMatchObject({ kind: 'invalid_request' })
  expect(fetch).not.toHaveBeenCalled()
})
