import { describe, expect, it, vi } from 'vitest'

import {
  createLlmConnectionChecker,
  InvalidLlmBaseUrlError,
} from './llm-connection'

describe('LLM connection checker', () => {
  it('checks the models endpoint without credentials for a keyless server', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"data":[]}'))
    const check = createLlmConnectionChecker({ fetch, hasKey: () => false })

    await check({
      id: 'local',
      type: 'openaiCompatible',
      baseUrl: ' http://localhost:11434/v1/ ',
    })

    expect(fetch).toHaveBeenCalledWith('http://localhost:11434/v1/models', {
      headers: undefined,
      signal: expect.any(AbortSignal),
    })
  })

  it('uses a secret reference instead of exposing the saved key', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"data":[]}'))
    const check = createLlmConnectionChecker({ fetch, hasKey: () => true })

    await check({
      id: 'private-server',
      type: 'openaiCompatible',
      baseUrl: 'https://llm.example/v1',
    })

    expect(fetch).toHaveBeenCalledWith('https://llm.example/v1/models', {
      headers: { Authorization: 'Bearer tyco-secret:llm.private-server' },
      signal: expect.any(AbortSignal),
    })
  })

  it('explains a server that does not answer with JSON', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('<html>nope</html>'))
    const check = createLlmConnectionChecker({ fetch, hasKey: () => false })

    await expect(
      check({
        id: 'local',
        type: 'openaiCompatible',
        baseUrl: 'http://localhost:8080',
      })
    ).rejects.toThrow('did not return an OpenAI-compatible model list')
  })

  it('rejects invalid and non-http addresses before making a request', async () => {
    const fetch = vi.fn()
    const check = createLlmConnectionChecker({ fetch, hasKey: () => false })

    await expect(
      check({
        id: 'local',
        type: 'openaiCompatible',
        baseUrl: 'file:///tmp/server',
      })
    ).rejects.toBeInstanceOf(InvalidLlmBaseUrlError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports unsuccessful HTTP responses', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
    const check = createLlmConnectionChecker({ fetch, hasKey: () => true })

    await expect(
      check({
        id: 'private-server',
        type: 'openaiCompatible',
        baseUrl: 'https://llm.example/v1',
      })
    ).rejects.toThrow('HTTP 401')
  })

  it('does not report an unrelated reachable server as ready', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }))
    const check = createLlmConnectionChecker({ fetch, hasKey: () => false })

    await expect(
      check({
        id: 'local',
        type: 'openaiCompatible',
        baseUrl: 'http://localhost:11434/v1',
      })
    ).rejects.toThrow('HTTP 404')
  })
})

it('checks actual generation and reports a configured model that cannot run', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response('{"data":[{"id":"model"}]}'))
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
  const check = createLlmConnectionChecker({
    fetch,
    hasKey: () => false,
    getModelId: () => 'model',
  })
  await expect(
    check({
      id: 'local',
      type: 'openaiCompatible',
      baseUrl: 'http://localhost:11434/v1',
    })
  ).rejects.toThrow('Model model: HTTP 404')
  expect(fetch.mock.calls[1][0]).toBe(
    'http://localhost:11434/v1/chat/completions'
  )
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({
    model: 'model',
    max_tokens: 8,
    stream: false,
  })
})

it('does not accept an arbitrary JSON response as a model list', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}'))
  const check = createLlmConnectionChecker({ fetch, hasKey: () => false })
  await expect(
    check({
      id: 'local',
      type: 'openaiCompatible',
      baseUrl: 'http://localhost:11434/v1',
    })
  ).rejects.toThrow('model list')
})
