import type { FetchFunction, Transport } from '@bozonx/ai-kit'
import { DEFAULT_LLM_CONFIG, type LlmConfig } from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'

import { createSecretKeyProvider } from '../net/secrets'
import { LlmError, createLlmClient, isKeylessProvider } from './llm-client'
import { llmErrorKey } from './llm-errors'

const encoder = new TextEncoder()

function sse(chunks: string[]) {
  return [
    ...chunks.map(
      (content, index) =>
        `data: ${JSON.stringify({
          id: '1',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'm',
          choices: [
            {
              index: 0,
              delta: { content },
              finish_reason: index === chunks.length - 1 ? 'stop' : null,
            },
          ],
        })}\n\n`
    ),
    'data: [DONE]\n\n',
  ]
}

function streamResponse(parts: string[]) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        parts.forEach((part) => controller.enqueue(encoder.encode(part)))
        controller.close()
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } }
  )
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function setup(
  fetch: FetchFunction,
  llm: LlmConfig = structuredClone(DEFAULT_LLM_CONFIG),
  secrets: Record<string, { origins: string[] }> = {}
) {
  const transport: Transport = {
    fetch,
    openSocket: () => Promise.reject(new Error('no sockets in this test')),
  }
  const config = { current: llm }
  const client = createLlmClient({
    getConfig: () => config.current,
    transport,
    keys: createSecretKeyProvider(
      async () => secrets,
      (provider) => isKeylessProvider(config.current, provider)
    ),
  })
  return { client, config }
}

const prompt = { messages: [{ role: 'user' as const, content: 'hi' }] }

describe('llm-client', () => {
  it('streams an answer from the task model', async () => {
    const fetch = vi.fn<FetchFunction>(async () =>
      streamResponse(sse(['Hel', 'lo']))
    )
    const { client } = setup(fetch)
    const chunks: string[] = []

    const text = await client.run('chat', prompt, {
      onChunk: (chunk) => chunks.push(chunk),
    })

    expect(text).toBe('Hello')
    expect(chunks).toEqual(['Hel', 'lo'])
    const [url, init] = fetch.mock.calls[0]
    expect(String(url)).toBe('http://localhost:11434/v1/chat/completions')
    const body = JSON.parse(String(init?.body))
    expect(body.model).toBe('qwen2.5:7b')
    expect(body.temperature).toBe(0.2)
    expect(new Headers(init?.headers).get('authorization')).toBeNull()
  })

  it('answers in one piece without onChunk', async () => {
    const fetch = vi.fn<FetchFunction>(async () =>
      jsonResponse(200, {
        id: '1',
        object: 'chat.completion',
        created: 1,
        model: 'm',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Fixed text' },
            finish_reason: 'stop',
          },
        ],
      })
    )
    const { client } = setup(fetch)

    await expect(client.run('correction', prompt)).resolves.toBe('Fixed text')
  })

  it('falls back to the next model when a key is missing', async () => {
    const fetch = vi.fn<FetchFunction>(async () =>
      streamResponse(sse(['from local']))
    )
    const llm = structuredClone(DEFAULT_LLM_CONFIG)
    llm.tasks.chat = ['gemini-flash', 'local-qwen']
    const { client } = setup(fetch, llm)

    const text = await client.run('chat', prompt, { onChunk: () => undefined })

    expect(text).toBe('from local')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('uses each fallback model own generation settings', async () => {
    const fetch = vi.fn<FetchFunction>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string }
      return body.model === 'first-model'
        ? jsonResponse(503, { error: { message: 'busy' } })
        : streamResponse(sse(['fallback']))
    })
    const llm = structuredClone(DEFAULT_LLM_CONFIG)
    llm.models = [
      {
        id: 'first',
        provider: 'local',
        model: 'first-model',
        temperature: 0.9,
        maxOutputTokens: 100,
      },
      {
        id: 'second',
        provider: 'local',
        model: 'second-model',
        temperature: 0.1,
        maxOutputTokens: 200,
      },
    ]
    llm.tasks.chat = ['first', 'second']
    const { client } = setup(fetch, llm)

    await expect(
      client.run('chat', prompt, { onChunk: () => undefined })
    ).resolves.toBe('fallback')

    const bodies = fetch.mock.calls.map((call) =>
      JSON.parse(String(call[1]?.body))
    )
    expect(bodies[0]).toMatchObject({
      model: 'first-model',
      temperature: 0.9,
      max_tokens: 100,
    })
    expect(bodies.at(-1)).toMatchObject({
      model: 'second-model',
      temperature: 0.1,
      max_tokens: 200,
    })
  })

  it('sends a key reference to a provider that has a key', async () => {
    const fetch = vi.fn<FetchFunction>(async () => streamResponse(sse(['ok'])))
    const llm = structuredClone(DEFAULT_LLM_CONFIG)
    llm.tasks.chat = ['deepseek-chat']
    const { client } = setup(fetch, llm, {
      deepseek: { origins: ['https://api.deepseek.com'] },
    })

    await client.run('chat', prompt, { onChunk: () => undefined })

    const [url, init] = fetch.mock.calls[0]
    expect(String(url)).toBe('https://api.deepseek.com/chat/completions')
    expect(new Headers(init?.headers).get('authorization')).toBe(
      'Bearer tyco-secret:deepseek'
    )
  })

  it('reports a refused key as an auth error', async () => {
    const fetch = vi.fn<FetchFunction>(async () =>
      jsonResponse(401, { error: { message: 'bad key' } })
    )
    const { client } = setup(fetch)

    const error = await client.run('chat', prompt).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(LlmError)
    expect((error as LlmError).kind).toBe('auth')
    expect(llmErrorKey((error as LlmError).kind)).toBe('llmErrors.auth')
  })

  it('reports a task with no usable model', async () => {
    const llm = structuredClone(DEFAULT_LLM_CONFIG)
    llm.models = llm.models.map((model) => ({ ...model, model: '' }))
    const { client } = setup(vi.fn<FetchFunction>(), llm)

    await expect(client.run('chat', prompt)).rejects.toMatchObject({
      kind: 'no_model',
    })
  })

  it('resolves with the text so far when aborted mid-stream', async () => {
    const controller = new AbortController()
    const fetch = vi.fn<FetchFunction>(
      async (_input, init) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(stream) {
              stream.enqueue(encoder.encode(sse(['partial'])[0]))
              init?.signal?.addEventListener('abort', () =>
                stream.error(init.signal?.reason)
              )
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } }
        )
    )
    const { client } = setup(fetch)

    const text = await client.run('chat', prompt, {
      signal: controller.signal,
      onChunk: () => controller.abort(),
    })

    expect(text).toBe('partial')
  })

  it('picks up a changed config', async () => {
    const fetch = vi.fn<FetchFunction>(async () => streamResponse(sse(['ok'])))
    const { client, config } = setup(fetch)
    await client.run('chat', prompt, { onChunk: () => undefined })

    const next = structuredClone(DEFAULT_LLM_CONFIG)
    next.models[0].model = 'llama3'
    config.current = next
    await client.run('chat', prompt, { onChunk: () => undefined })

    const body = JSON.parse(String(fetch.mock.calls[1][1]?.body))
    expect(body.model).toBe('llama3')
  })
})
