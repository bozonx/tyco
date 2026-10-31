import { describe, expect, it, vi } from 'vitest'

import {
  createTranslationClient,
  type TranslationClientDependencies,
} from './translation-client'
import { DEFAULT_USER_CONFIG, type TranslationConfig } from '@tyco/shared'

function config(overrides: Partial<TranslationConfig> = {}): TranslationConfig {
  return {
    ...DEFAULT_USER_CONFIG.translation,
    provider: 'llm',
    qualityGate: 'off',
    providers: { deepl: { endpoint: 'free' } },
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

  it('adds the correction prompt only to the always-on correction pass', async () => {
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

    await client.translate('Hello.', {
      targetLanguage: 'ru',
      qualityGateRules: 'Use formal tone.',
    })

    expect(runLlm.mock.calls[0]?.[0].system).not.toContain('Use formal tone.')
    expect(runLlm.mock.calls[1]?.[0].system).toContain('Use formal tone.')
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
      targetLanguage: 'ru-RU',
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

  it('gives the LLM the glossary translation into the target language only', async () => {
    const runLlm = vi.fn().mockResolvedValue('Translated.')
    const client = createTranslationClient({
      getConfig: () =>
        config({
          glossary: [
            {
              term: 'workspace',
              translation: '',
              translations: { ru: 'рабочее пространство', es: 'espacio' },
            },
            { term: 'board', translation: '', translations: { ru: 'доска' } },
            { term: 'TyCo', translation: 'TyCo' },
          ],
        }),
      keys: { get: vi.fn() },
      transport: { fetch: vi.fn(), openSocket: vi.fn() },
      runLlm,
    })
    const source = 'The TyCo workspace board.'

    await client.translate(source, { targetLanguage: 'es-AR' })
    await client.translate(source, { targetLanguage: 'ru-RU' })

    const spanish = runLlm.mock.calls[0]?.[0].system as string
    expect(spanish).toContain('- workspace: espacio')
    expect(spanish).toContain('- TyCo: keep exactly as written')
    expect(spanish).not.toContain('board')
    expect(spanish).not.toContain('рабочее')
    const russian = runLlm.mock.calls[1]?.[0].system as string
    expect(russian).toContain('- workspace: рабочее пространство')
    expect(russian).toContain('- board: доска')
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

  it('captures and returns the LLM provider and model when reported', async () => {
    const runLlm = vi.fn((_prompt, _signal, options) => {
      options?.onModel?.({ provider: 'openai', model: 'gpt-4o-mini' })
      return Promise.resolve('Привет.')
    })
    const client = createTranslationClient({
      getConfig: () => config(),
      keys: { get: vi.fn() },
      transport: { fetch: vi.fn(), openSocket: vi.fn() },
      runLlm,
    })

    const result = await client.translate('Hello.', { targetLanguage: 'ru' })

    expect(result.text).toBe('Привет.')
    expect(result.provider).toBe('openai')
    expect(result.model).toBe('gpt-4o-mini')
  })

  it('keeps the breaks between the pieces of a long text', async () => {
    const runLlm = vi
      .fn()
      .mockResolvedValueOnce('First part.')
      .mockResolvedValueOnce('Second part.')
    const client = createTranslationClient({
      getConfig: () => config(),
      keys: { get: vi.fn() },
      transport: { fetch: vi.fn(), openSocket: vi.fn() },
      runLlm,
    })

    const result = await client.translate(
      `${'a'.repeat(30_000)}\n\n${'b'.repeat(30_000)}`,
      { targetLanguage: 'ru' }
    )

    expect(runLlm).toHaveBeenCalledTimes(2)
    expect(result.text).toBe('First part.\n\nSecond part.')
  })
})

it('splits translation against the smallest context and output budget', async () => {
  const runLlm = vi.fn().mockResolvedValue('Translated.')
  const client = createTranslationClient({
    getConfig: () => config(),
    getLlmLimits: () => ({ contextWindowTokens: 4096, maxOutputTokens: 1024 }),
    keys: { get: vi.fn() },
    transport: { fetch: vi.fn(), openSocket: vi.fn() },
    runLlm,
  })
  await client.translate('source '.repeat(200), { targetLanguage: 'ru' })
  expect(runLlm.mock.calls.length).toBeGreaterThan(1)
  expect(
    runLlm.mock.calls.every(
      ([prompt]) => prompt.messages[0].content.length < 1500
    )
  ).toBe(true)
})

describe('LLM translation of protected text', () => {
  const setup = (runLlm: TranslationClientDependencies['runLlm']) =>
    createTranslationClient({
      getConfig: () => config(),
      keys: { get: vi.fn() },
      transport: { fetch: vi.fn(), openSocket: vi.fn() },
      runLlm,
    })

  it('keeps links out of the model and puts them back', async () => {
    const runLlm = vi.fn().mockResolvedValue('Смотри __TYCO_PROTECTED_0__')
    const result = await setup(runLlm).translate('See https://example.com/a', {
      targetLanguage: 'ru',
    })

    expect(runLlm.mock.calls[0]?.[0].messages[0]?.content).not.toContain(
      'https://example.com/a'
    )
    expect(result.text).toBe('Смотри https://example.com/a')
  })

  it('sends the plain chunk again when the model drops a token', async () => {
    const runLlm = vi
      .fn()
      .mockResolvedValueOnce('Смотри ссылку')
      .mockResolvedValueOnce('Смотри https://example.com/a')
    const result = await setup(runLlm).translate('See https://example.com/a', {
      targetLanguage: 'ru',
    })

    expect(runLlm).toHaveBeenCalledTimes(2)
    expect(runLlm.mock.calls[1]?.[0].messages[0]?.content).toContain(
      'https://example.com/a'
    )
    expect(result.text).toBe('Смотри https://example.com/a')
  })

  it('gives a later chunk the end of the previous one for context', async () => {
    const runLlm = vi.fn().mockResolvedValue('Перевод.')
    await setup(runLlm).translate(
      `${'a'.repeat(30_000)} tail-of-first\n\n${'b'.repeat(30_000)}`,
      { targetLanguage: 'ru' }
    )

    const first = runLlm.mock.calls[0]?.[0].messages[0]?.content as string
    const second = runLlm.mock.calls[1]?.[0].messages[0]?.content as string
    expect(first).not.toContain('preceding_text')
    expect(second).toContain('preceding_text')
    expect(second).toContain('tail-of-first')
  })
})

it('sends a machine translator plain text, not HTML', async () => {
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

  const result = await client.translate('One\nTwo & three', {
    targetLanguage: 'ru',
  })

  expect(JSON.parse(String(send.mock.calls[0]?.[1]?.body)).format).toBe('text')
  expect(result.text).toBe('One\nTwo & three')
})

it('falls back to unprotected chunk if machine translator corrupts protected tokens', async () => {
  let callCount = 0
  const send = vi.fn((_url: URL | RequestInfo, _init?: RequestInit) => {
    callCount++
    // First call has protected token, provider returns mangled tokens that cannot be restored
    if (callCount === 1) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              translations: [{ translatedText: 'Corrupted completely' }],
            },
          })
        )
      )
    }
    // Fallback call returns plain translated text
    return Promise.resolve(
      new Response(
        JSON.stringify({
          data: {
            translations: [{ translatedText: 'Привет https://example.com' }],
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

  const result = await client.translate('Hello https://example.com', {
    targetLanguage: 'ru',
  })

  expect(send).toHaveBeenCalledTimes(2)
  expect(result.text).toBe('Привет https://example.com')
})
