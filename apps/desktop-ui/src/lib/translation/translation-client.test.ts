import { describe, expect, it, vi } from 'vitest'

import { createTranslationClient } from './translation-client'
import type { TranslationConfig } from '@tyco/shared'

function config(overrides: Partial<TranslationConfig> = {}): TranslationConfig {
  return {
    provider: 'llm',
    qualityGate: 'off',
    deeplEndpoint: 'free',
    glossary: [],
    ...overrides,
  }
}

describe('createTranslationClient', () => {
  it('runs exactly two LLM passes when quality repair is always enabled', async () => {
    const runLlm = vi
      .fn()
      .mockResolvedValueOnce('Привет.')
      .mockResolvedValueOnce('Здравствуйте.')
    const client = createTranslationClient({
      getConfig: () => config({ qualityGate: 'always' }),
      keys: { get: vi.fn() },
      transport: { fetch: vi.fn(), openSocket: vi.fn() },
      runLlm,
    })

    const result = await client.translate('Hello.', { targetLanguage: 'ru' })

    expect(runLlm).toHaveBeenCalledTimes(2)
    expect(result.text).toBe('Здравствуйте.')
    expect(result.quality.repaired).toBe(true)
  })

  it('uses the selected machine provider and protects placeholders', async () => {
    const send = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              translations: [
                {
                  translatedText: 'Привет TYCOPROTECTED0TOKEN',
                  detectedSourceLanguage: 'en',
                },
              ],
            },
          })
        )
      )
    )
    const client = createTranslationClient({
      getConfig: () => config({ provider: 'google' }),
      keys: { get: () => Promise.resolve('secret') },
      transport: { fetch: send, openSocket: vi.fn() },
      runLlm: vi.fn(),
    })

    const result = await client.translate('Hello {{name}}', {
      targetLanguage: 'ru_RU',
    })

    expect(result.text).toBe('Привет {{name}}')
    expect(result.provider).toBe('google-translate')
    expect(send).toHaveBeenCalledOnce()
  })
})
