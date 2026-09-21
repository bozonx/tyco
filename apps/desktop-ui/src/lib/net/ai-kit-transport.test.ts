import { Catalog, createAiKit, type StreamPart } from '@bozonx/ai-kit'
import { DESKTOP_COMMANDS } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import { bytes, createFakeNetIpc } from './fake-net-ipc'
import { createSecretKeyProvider } from './secrets'
import { createTauriTransport } from './tauri-net'

/** What an OpenAI-compatible server streams for a two-token answer */
const SSE_CHUNKS = [
  'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"Hel"}}]}\n\n',
  'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":"stop"}]}\n\n',
  'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"m","choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
  'data: [DONE]\n\n',
]

function createKit(
  handler: Parameters<typeof createFakeNetIpc>[0] = {},
  secrets: Record<string, { origins: string[] }> = {}
) {
  const fake = createFakeNetIpc(handler)
  const kit = createAiKit({
    catalog: Catalog.fromObject({
      requirePricing: false,
      models: [
        {
          name: 'local',
          provider: 'openai-compatible',
          model: 'qwen',
          tier: 'standard',
          contextSize: 32000,
          maxOutputTokens: 4096,
          baseUrl: 'http://localhost:11434/v1',
        },
      ],
      taskClasses: { chat: ['local'] },
    }),
    keys: createSecretKeyProvider(async () => secrets),
    transport: createTauriTransport(fake.ipc),
  })
  return { fake, kit }
}

describe('ai-kit over the Tauri transport', () => {
  it('streams an answer through the proxy with a key reference', async () => {
    const { fake, kit } = createKit(
      {
        [DESKTOP_COMMANDS.NET_FETCH]: (_call, emit) => {
          setTimeout(() => {
            emit({
              type: 'head',
              status: 200,
              statusText: 'OK',
              headers: [['content-type', 'text/event-stream']],
            })
            SSE_CHUNKS.forEach((chunk) => emit(bytes(chunk)))
            emit({ type: 'end' })
          })
          return 1
        },
      },
      { 'openai-compatible': { origins: ['http://localhost:11434'] } }
    )

    const parts: StreamPart[] = []
    for await (const part of kit.stream({
      policy: { taskClass: 'chat' },
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      parts.push(part)
    }

    const text = parts
      .flatMap((part) => (part.type === 'text-delta' ? [part.text] : []))
      .join('')
    expect(text).toBe('Hello')
    expect(parts.at(-1)?.type).toBe('finish')

    const [call] = fake.callsOf(DESKTOP_COMMANDS.NET_FETCH)
    const request = (
      call.args as { request: { url: string; headers: [string, string][] } }
    ).request
    expect(request.url).toBe('http://localhost:11434/v1/chat/completions')
    expect(request.headers).toContainEqual([
      'authorization',
      'Bearer tyco-secret:openai-compatible',
    ])
  })

  it('classifies a refused key as an auth failure', async () => {
    const { kit } = createKit({
      [DESKTOP_COMMANDS.NET_FETCH]: (_call, emit) => {
        setTimeout(() => {
          emit({ type: 'head', status: 401, statusText: '', headers: [] })
          emit(bytes('{"error":{"message":"bad key"}}'))
          emit({ type: 'end' })
        })
        return 1
      },
    })

    await expect(
      kit.generate({
        policy: { taskClass: 'chat' },
        messages: [{ role: 'user', content: 'hi' }],
      })
    ).rejects.toMatchObject({ kind: 'auth' })
  })
})
