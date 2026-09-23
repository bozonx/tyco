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
    expect(runLlm.mock.calls[1]?.[0].messages[0]?.content).toContain(
      'Review it once and fix any translation errors you find.'
    )
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
                  translatedText: 'Привет __TYCO_PROTECTED_0__',
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

  it('sends long machine translations as separate provider requests', async () => {
    const send = vi.fn((_url: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { q: string[] }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              translations: body.q.map((text) => ({ translatedText: text })),
            },
          })
        )
      )
    })
    const client = createTranslationClient({
      getConfig: () => config({ provider: 'google' }),
      keys: { get: () => Promise.resolve('secret') },
      transport: { fetch: send, openSocket: vi.fn() },
      runLlm: vi.fn(),
    })
    const source = `${'word '.repeat(1_000)}\n${'more '.repeat(1_000)}`

    const result = await client.translate(source, { targetLanguage: 'ru' })

    expect(result.text).toBe(source)
    expect(send.mock.calls.length).toBeGreaterThan(1)
    for (const [, init] of send.mock.calls) {
      const body = JSON.parse(String(init?.body)) as { q: string[] }
      expect(body.q).toHaveLength(1)
      expect(body.q[0]!.length).toBeLessThanOrEqual(4_500)
    }
  })

  it('rejects an empty LLM result', async () => {
    const client = createTranslationClient({
      getConfig: () => config(),
      keys: { get: vi.fn() },
      transport: { fetch: vi.fn(), openSocket: vi.fn() },
      runLlm: vi.fn().mockResolvedValue(''),
    })

    await expect(
      client.translate('Hello.', { targetLanguage: 'ru' })
    ).rejects.toMatchObject({ kind: 'invalid_output' })
  })

  it('rejects an LLM result returned after cancellation', async () => {
    const controller = new AbortController()
    const client = createTranslationClient({
      getConfig: () => config(),
      keys: { get: vi.fn() },
      transport: { fetch: vi.fn(), openSocket: vi.fn() },
      runLlm: vi.fn().mockImplementation(() => {
        controller.abort()
        return Promise.resolve('')
      }),
    })

    await expect(
      client.translate('Hello.', {
        targetLanguage: 'ru',
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
