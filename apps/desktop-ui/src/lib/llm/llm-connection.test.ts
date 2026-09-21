import { describe, expect, it, vi } from 'vitest'

import {
  createLlmConnectionChecker,
  InvalidLlmBaseUrlError,
} from './llm-connection'

describe('LLM connection checker', () => {
  it('checks the models endpoint without credentials for a keyless server', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}'))
    const check = createLlmConnectionChecker({ fetch, hasKey: () => false })

    await check({
      id: 'local',
      type: 'openai-compatible',
      baseUrl: ' http://localhost:11434/v1/ ',
    })

    expect(fetch).toHaveBeenCalledWith('http://localhost:11434/v1/models', {
      headers: undefined,
    })
  })

  it('uses a secret reference instead of exposing the saved key', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}'))
    const check = createLlmConnectionChecker({ fetch, hasKey: () => true })

    await check({
      id: 'private-server',
      type: 'openai-compatible',
      baseUrl: 'https://llm.example/v1',
    })

    expect(fetch).toHaveBeenCalledWith('https://llm.example/v1/models', {
      headers: { Authorization: 'Bearer tyco-secret:private-server' },
    })
  })

  it('rejects invalid and non-http addresses before making a request', async () => {
    const fetch = vi.fn()
    const check = createLlmConnectionChecker({ fetch, hasKey: () => false })

    await expect(
      check({
        id: 'local',
        type: 'openai-compatible',
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
        type: 'openai-compatible',
        baseUrl: 'https://llm.example/v1',
      })
    ).rejects.toThrow('HTTP 401')
  })
})
