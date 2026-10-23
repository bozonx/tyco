import {
  AiError,
  AllCandidatesFailedError,
  CatalogError,
  NoSuitableModelError,
  type StreamPart,
} from '@bozonx/ai-kit'
import { DEFAULT_LLM_CONFIG, type LlmConfig } from '@tyco/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  LlmError,
  createLlmClient,
  toLlmError,
  type LlmStreamEvent,
} from './llm-client'

/** Each call of the fake kit plays the next script: stream parts or an error */
const kit = vi.hoisted(() => ({
  scripts: [] as Array<unknown[] | Error>,
  created: 0,
}))

vi.mock(import('@bozonx/ai-kit'), async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    createAiKit: (() => {
      kit.created += 1
      return {
        async *stream() {
          const script = kit.scripts.shift()
          if (script instanceof Error) throw script
          for (const part of script ?? []) yield part as StreamPart
        },
        async generate() {
          const script = kit.scripts.shift()
          if (script instanceof Error) throw script
          return script![0]
        },
      }
    }) as unknown as typeof original.createAiKit,
  }
})

function setup(config: LlmConfig = structuredClone(DEFAULT_LLM_CONFIG)) {
  return createLlmClient({
    getConfig: () => config,
    transport: { fetch: vi.fn(), openSocket: vi.fn() },
    keys: { getKey: vi.fn() } as never,
  })
}

const prompt = { messages: [{ role: 'user' as const, content: 'hi' }] }
const imagePrompt = {
  messages: [
    {
      role: 'user' as const,
      content: [
        {
          type: 'file' as const,
          data: new Uint8Array([1]),
          mediaType: 'image/png',
        },
      ],
    },
  ],
}

async function collect(stream: AsyncIterable<LlmStreamEvent>) {
  const events: LlmStreamEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

beforeEach(() => {
  kit.scripts = []
  kit.created = 0
})

describe('llm-client stream parts', () => {
  it('translates every kind of stream part', async () => {
    kit.scripts.push([
      { type: 'reasoning-delta', text: 'thinking' },
      { type: 'tool-denied', toolCallId: 'c1', toolName: 'search' },
      {
        type: 'tool-approval-request',
        approvalId: 'a0',
        toolCallId: 'c0',
        toolName: 'search',
        args: {},
        isAutomatic: true,
      },
      { type: 'file', mediaType: 'image/png', data: 'AAAA' },
      { type: 'sources', sources: [{ url: 'https://example.com' }] },
      { type: 'usage' },
      { type: 'text-delta', text: 'Answer' },
      { type: 'finish', finishReason: 'stop', responseMessages: [] },
    ])
    const events = await collect(setup().stream('aiTask', prompt))
    expect(events.map((event) => event.type)).toEqual([
      'reasoning',
      'tool-denied',
      'file',
      'sources',
      'text',
      'finish',
    ])
  })

  it('reports a stream error part with the text so far', async () => {
    kit.scripts.push([
      { type: 'text-delta', text: 'Partial' },
      { type: 'error', kind: 'rate_limit', message: 'Slow down' },
    ])
    const failure = collect(setup().stream('aiTask', prompt))
    await expect(failure).rejects.toMatchObject({
      kind: 'rate_limit',
      partialText: 'Partial',
    })
  })

  it('maps a missing candidate to no_model', async () => {
    kit.scripts.push([
      { type: 'error', kind: 'no_candidates', message: 'Nobody' },
    ])
    await expect(
      collect(setup().stream('aiTask', prompt))
    ).rejects.toMatchObject({ kind: 'no_model' })
  })

  it('rejects a stream that ends without a finish', async () => {
    kit.scripts.push([{ type: 'text-delta', text: 'Cut' }])
    await expect(
      collect(setup().stream('aiTask', prompt))
    ).rejects.toMatchObject({ kind: 'invalid_output', partialText: 'Cut' })
  })

  it('names a filtered answer', async () => {
    kit.scripts.push([
      { type: 'text-delta', text: 'Bad' },
      { type: 'finish', finishReason: 'content-filter', responseMessages: [] },
    ])
    await expect(
      collect(setup().stream('aiTask', prompt))
    ).rejects.toMatchObject({ kind: 'content_filter' })
  })

  it('stays silent when aborted at an error part', async () => {
    const controller = new AbortController()
    kit.scripts.push([
      { type: 'text-delta', text: 'Text' },
      { type: 'error', kind: 'unknown', message: 'Late' },
    ])
    const events: LlmStreamEvent[] = []
    for await (const event of setup().stream('aiTask', prompt, {
      signal: controller.signal,
    })) {
      events.push(event)
      controller.abort()
    }
    expect(events).toHaveLength(1)
  })

  it('names an image refusal when no model answers', async () => {
    kit.scripts.push(new AiError('unknown', 'Vision is not supported here'))
    await expect(
      collect(
        setup().stream('chat', imagePrompt as never, {
          models: ['ollama-qwen'],
        })
      )
    ).rejects.toMatchObject({ kind: 'image_unsupported' })
  })
})

describe('llm-client generate', () => {
  it('reports the model and rejects incomplete answers', async () => {
    const onModel = vi.fn()
    kit.scripts.push([
      { provider: 'p', model: 'm', text: 'Done', finishReason: 'stop' },
    ])
    await expect(setup().run('aiTask', prompt, { onModel })).resolves.toBe(
      'Done'
    )
    expect(onModel).toHaveBeenCalledWith({ provider: 'p', model: 'm' })
    kit.scripts.push([
      { provider: 'p', model: 'm', text: 'Part', finishReason: 'length' },
    ])
    await expect(setup().run('aiTask', prompt)).rejects.toMatchObject({
      kind: 'output_truncated',
      partialText: 'Part',
    })
  })

  it('returns nothing for a call aborted before it starts', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      setup().run('aiTask', prompt, { signal: controller.signal })
    ).resolves.toBe('')
  })

  it('reuses one kit for one config', async () => {
    const client = setup()
    kit.scripts.push(
      [{ provider: 'p', model: 'm', text: 'One', finishReason: 'stop' }],
      [{ provider: 'p', model: 'm', text: 'Two', finishReason: 'stop' }]
    )
    await client.run('aiTask', prompt)
    await client.run('aiTask', prompt)
    expect(kit.created).toBe(1)
  })
})

describe('toLlmError', () => {
  it.each([
    [new LlmError('auth', 'Key'), 'auth', 'Key'],
    [new NoSuitableModelError('No model'), 'no_model', 'No model'],
    [new CatalogError('Broken catalog'), 'config', 'Broken catalog'],
    [
      new AllCandidatesFailedError([
        {
          provider: 'p',
          model: 'm',
          error: new AiError('rate_limit', 'Too fast'),
        },
      ]),
      'rate_limit',
      'Too fast',
    ],
    [new AllCandidatesFailedError([]), 'unknown', undefined],
    [new AiError('timeout', 'Slow'), 'timeout', 'Slow'],
    ['text', 'unknown', 'text'],
  ])('maps %s', (error, kind, message) => {
    const mapped = toLlmError(error)
    expect(mapped.kind).toBe(kind)
    if (message !== undefined) expect(mapped.message).toBe(message)
  })
})
