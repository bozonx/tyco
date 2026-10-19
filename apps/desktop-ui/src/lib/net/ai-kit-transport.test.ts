import { Catalog, createAiKit, type StreamPart } from '@bozonx/ai-kit'
import { DESKTOP_COMMANDS, llmSecretId } from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'

import { bytes, createFakeNetIpc } from './fake-net-ipc'
import { createSecretKeyProvider } from './secrets'
import { createTauriTransport } from './tauri-net'
import { createSttClient } from '../stt/stt-client'
import { createAsyncQueue } from './async-queue'
import type { AudioChunk } from '@bozonx/ai-kit'

/** What an OpenAI-compatible server streams for a two-token answer */
const SSE_CHUNKS = [
  'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"Hel"}}]}\n\n',
  'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":"stop"}]}\n\n',
  'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"m","choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
  'data: [DONE]\n\n',
]

function createKit(
  handler: Parameters<typeof createFakeNetIpc>[0] = {},
  secrets: Record<string, { origins: string[]; available: boolean }> = {}
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
    keys: createSecretKeyProvider(async () => secrets, llmSecretId),
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
      {
        'llm.openai-compatible': {
          origins: ['http://localhost:11434'],
          available: true,
        },
      }
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
      'Bearer tyco-secret:llm.openai-compatible',
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
  it('propagates chat cancellation through the SDK to the Rust proxy', async () => {
    const controller = new AbortController()
    const { fake, kit } = createKit({
      [DESKTOP_COMMANDS.NET_FETCH]: (_call, emit) => {
        setTimeout(() => {
          emit({
            type: 'head',
            status: 200,
            statusText: 'OK',
            headers: [['content-type', 'text/event-stream']],
          })
          emit(bytes(SSE_CHUNKS[0]))
        })
        return 4
      },
    })
    const text: string[] = []
    for await (const part of kit.stream({
      policy: { taskClass: 'chat' },
      messages: [{ role: 'user', content: 'hi' }],
      abortSignal: controller.signal,
    })) {
      if (part.type === 'text-delta') {
        text.push(part.text)
        controller.abort()
      }
    }
    expect(text).toEqual(['Hel'])
    expect(fake.callsOf(DESKTOP_COMMANDS.NET_FETCH)).toHaveLength(1)
    expect(fake.callsOf(DESKTOP_COMMANDS.NET_CANCEL)).toHaveLength(1)
    expect(fake.callsOf(DESKTOP_COMMANDS.NET_CANCEL)[0].args).toEqual({ id: 4 })
  })

  it('propagates STT cancellation through the kit while its handshake is pending', async () => {
    const fake = createFakeNetIpc({
      [DESKTOP_COMMANDS.NET_SOCKET_OPEN]: () => 5,
    })
    const controller = new AbortController()
    const audio = createAsyncQueue<AudioChunk>()
    const stt = createSttClient({ transport: createTauriTransport(fake.ipc) })
    const pending = (async () => {
      for await (const _part of stt.transcribeLive({
        model: { provider: 'deepgram', modelId: 'nova-3' },
        audio: audio.values,
        sampleRate: 16000,
        hasApiKey: true,
        signal: controller.signal,
      })) {
        /* Drain the terminal cancellation event. */
      }
    })()
    await vi.waitFor(() =>
      expect(fake.callsOf(DESKTOP_COMMANDS.NET_SOCKET_OPEN)).toHaveLength(1)
    )
    const rejected = expect(pending).rejects.toMatchObject({ kind: 'aborted' })
    controller.abort()
    await rejected
    expect(fake.callsOf(DESKTOP_COMMANDS.NET_SOCKET_OPEN)).toHaveLength(1)
    expect(fake.callsOf(DESKTOP_COMMANDS.NET_CANCEL)).toHaveLength(1)
    expect(fake.callsOf(DESKTOP_COMMANDS.NET_CANCEL)[0].args).toEqual({ id: 5 })
  })
})
