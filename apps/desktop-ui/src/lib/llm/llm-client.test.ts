import {
  dynamicTool,
  jsonSchema,
  toolApprovalResponse,
  type FetchFunction,
  type Transport,
} from '@bozonx/ai-kit'
import { DEFAULT_LLM_CONFIG, llmSecretId, type LlmConfig } from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'

import { createSecretKeyProvider } from '../net/secrets'
import {
  LlmError,
  createLlmClient,
  isKeylessProvider,
  type LlmStreamEvent,
} from './llm-client'
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
  secrets: Record<string, { origins: string[]; available: boolean }> = {}
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
      llmSecretId,
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

    const text = await client.run('aiTask', prompt, {
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

  it('runs the chat on the model it is given', async () => {
    const fetch = vi.fn<FetchFunction>(async () =>
      streamResponse(sse(['from deepseek']))
    )
    const { client } = setup(fetch, DEFAULT_LLM_CONFIG, {
      'llm.deepseek': {
        origins: ['https://api.deepseek.com'],
        available: true,
      },
    })

    const text = await client.run('chat', prompt, {
      modelId: 'deepseek-chat',
      onChunk: () => undefined,
    })

    expect(text).toBe('from deepseek')
    const [url] = fetch.mock.calls[0]
    expect(String(url)).toBe('https://api.deepseek.com/chat/completions')
  })

  it('refuses the chat without a model', async () => {
    const { client } = setup(vi.fn<FetchFunction>())

    await expect(client.run('chat', prompt)).rejects.toMatchObject({
      kind: 'no_model',
    })
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

  it('fails without a key instead of trying another model', async () => {
    const fetch = vi.fn<FetchFunction>(async () =>
      streamResponse(sse(['from local']))
    )
    const llm = structuredClone(DEFAULT_LLM_CONFIG)
    llm.tasks.aiTask.modelId = 'gemini-flash'
    const { client } = setup(fetch, llm)

    await expect(
      client.run('aiTask', prompt, { onChunk: () => undefined })
    ).rejects.toBeInstanceOf(LlmError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses the task model own generation settings', async () => {
    const fetch = vi.fn<FetchFunction>(async () =>
      streamResponse(sse(['answer']))
    )
    const llm = structuredClone(DEFAULT_LLM_CONFIG)
    llm.models = [
      {
        id: 'first',
        providerId: 'ollama',
        providerModelId: 'first-model',
        canUseImages: false,
        canUseTools: false,
        temperature: 0.9,
        maxOutputTokens: 100,
      },
      {
        id: 'second',
        providerId: 'ollama',
        providerModelId: 'second-model',
        canUseImages: false,
        canUseTools: false,
        temperature: 0.1,
        maxOutputTokens: 200,
      },
    ]
    llm.tasks.aiTask.modelId = 'second'
    const { client } = setup(fetch, llm)

    await expect(
      client.run('aiTask', prompt, { onChunk: () => undefined })
    ).resolves.toBe('answer')

    expect(fetch).toHaveBeenCalledOnce()
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: 'second-model',
      temperature: 0.1,
      max_tokens: 200,
    })
  })

  it('lets the request override the temperature and cap the output', async () => {
    const fetch = vi.fn<FetchFunction>(async () => streamResponse(sse(['ok'])))
    const llm = structuredClone(DEFAULT_LLM_CONFIG)
    llm.models = [
      {
        id: 'chosen',
        providerId: 'ollama',
        providerModelId: 'chosen-model',
        canUseImages: false,
        canUseTools: false,
        temperature: 0.9,
        maxOutputTokens: 300,
      },
    ]
    const { client } = setup(fetch, llm)

    await client.run('chat', prompt, {
      modelId: 'chosen',
      onChunk: () => undefined,
      temperature: 0.2,
      maxOutputTokens: 100,
    })
    await client.run('chat', prompt, {
      modelId: 'chosen',
      onChunk: () => undefined,
      maxOutputTokens: 5000,
    })

    const bodies = fetch.mock.calls.map((call) =>
      JSON.parse(String(call[1]?.body))
    )
    expect(bodies[0]).toMatchObject({ temperature: 0.2, max_tokens: 100 })
    expect(bodies[1]).toMatchObject({ temperature: 0.9, max_tokens: 300 })
  })

  it('leaves the output length to a model without a limit', async () => {
    const fetch = vi.fn<FetchFunction>(async () => streamResponse(sse(['ok'])))
    const llm = structuredClone(DEFAULT_LLM_CONFIG)
    delete llm.models[0].maxOutputTokens
    const { client } = setup(fetch, llm)

    await client.run('aiTask', prompt, { onChunk: () => undefined })

    expect(
      JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))
    ).not.toHaveProperty('max_tokens')
  })

  it('sends a key reference to a provider that has a key', async () => {
    const fetch = vi.fn<FetchFunction>(async () => streamResponse(sse(['ok'])))
    const llm = structuredClone(DEFAULT_LLM_CONFIG)
    llm.tasks.aiTask.modelId = 'deepseek-chat'
    const { client } = setup(fetch, llm, {
      'llm.deepseek': {
        origins: ['https://api.deepseek.com'],
        available: true,
      },
    })

    await client.run('aiTask', prompt, { onChunk: () => undefined })

    const [url, init] = fetch.mock.calls[0]
    expect(String(url)).toBe('https://api.deepseek.com/chat/completions')
    expect(new Headers(init?.headers).get('authorization')).toBe(
      'Bearer tyco-secret:llm.deepseek'
    )
  })

  it('reports a refused key as an auth error', async () => {
    const fetch = vi.fn<FetchFunction>(async () =>
      jsonResponse(401, { error: { message: 'bad key' } })
    )
    const { client } = setup(fetch)

    const error = await client.run('aiTask', prompt).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(LlmError)
    expect((error as LlmError).kind).toBe('auth')
    expect(llmErrorKey((error as LlmError).kind)).toBe('llmErrors.auth')
  })

  it('reports a task with no usable model', async () => {
    const llm = structuredClone(DEFAULT_LLM_CONFIG)
    llm.models = llm.models.map((model) => ({ ...model, providerModelId: '' }))
    const { client } = setup(vi.fn<FetchFunction>(), llm)

    await expect(client.run('aiTask', prompt)).rejects.toMatchObject({
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

    const text = await client.run('aiTask', prompt, {
      signal: controller.signal,
      onChunk: () => controller.abort(),
    })

    expect(text).toBe('partial')
  })

  it('picks up a changed config', async () => {
    const fetch = vi.fn<FetchFunction>(async () => streamResponse(sse(['ok'])))
    const { client, config } = setup(fetch)
    await client.run('aiTask', prompt, { onChunk: () => undefined })

    const next = structuredClone(DEFAULT_LLM_CONFIG)
    next.models[0].providerModelId = 'llama3'
    config.current = next
    await client.run('aiTask', prompt, { onChunk: () => undefined })

    const body = JSON.parse(String(fetch.mock.calls[1][1]?.body))
    expect(body.model).toBe('llama3')
  })
})

describe('vision transport', () => {
  const imagePrompt = {
    messages: [
      {
        role: 'user' as const,
        content: [
          {
            type: 'file' as const,
            data: new Uint8Array([1, 2, 3]),
            mediaType: 'image/png',
          },
        ],
      },
    ],
  }
  it('serializes image bytes through the configured transport and streams the reply', async () => {
    const fetch = vi.fn<FetchFunction>(async () =>
      streamResponse(sse(['Image reply']))
    )
    const llm = structuredClone(DEFAULT_LLM_CONFIG)
    llm.models[0].canUseImages = true
    const { client } = setup(fetch, llm)
    expect(
      await client.run('chat', imagePrompt, {
        modelId: 'ollama-qwen',
        onChunk: () => undefined,
      })
    ).toBe('Image reply')
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body))
    expect(body.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
      ],
    })
  })
  it('reports provider rejection of image input without losing the server detail', async () => {
    const fetch = vi.fn<FetchFunction>(async () =>
      jsonResponse(400, {
        error: {
          message: 'This model does not support images',
          type: 'invalid_request_error',
        },
      })
    )
    const llm = structuredClone(DEFAULT_LLM_CONFIG)
    llm.models[0].canUseImages = true
    const { client } = setup(fetch, llm)
    await expect(
      client.run('chat', imagePrompt, { modelId: 'ollama-qwen' })
    ).rejects.toMatchObject({
      kind: 'image_unsupported',
      message: expect.stringContaining('does not support images'),
    })
  })
  it('does not blame the images for an unrelated rejection', async () => {
    const fetch = vi.fn<FetchFunction>(async () =>
      jsonResponse(400, {
        error: {
          message: 'Unknown parameter: foo',
          type: 'invalid_request_error',
        },
      })
    )
    const llm = structuredClone(DEFAULT_LLM_CONFIG)
    llm.models[0].canUseImages = true
    const { client } = setup(fetch, llm)
    await expect(
      client.run('chat', imagePrompt, { modelId: 'ollama-qwen' })
    ).rejects.toMatchObject({ kind: 'invalid_request' })
  })

  it('refuses image input before transport when the model is text-only', async () => {
    const fetch = vi.fn<FetchFunction>()
    const { client } = setup(fetch)
    await expect(
      client.run('chat', imagePrompt, { modelId: 'ollama-qwen' })
    ).rejects.toMatchObject({ kind: 'no_model' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('built-in vision adapters', () => {
  const imagePrompt = {
    messages: [
      {
        role: 'user' as const,
        content: [
          {
            type: 'file' as const,
            data: new Uint8Array([1, 2, 3]),
            mediaType: 'image/png',
          },
        ],
      },
    ],
  }
  it('sends image data to Google through the transport', async () => {
    const fetch = vi.fn<FetchFunction>(async () =>
      jsonResponse(200, {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'Image reply' }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 1,
          candidatesTokenCount: 1,
          totalTokenCount: 2,
        },
      })
    )
    const { client } = setup(fetch, DEFAULT_LLM_CONFIG, {
      'llm.google': {
        origins: ['https://generativelanguage.googleapis.com'],
        available: true,
      },
    })
    expect(
      await client.run('chat', imagePrompt, { modelId: 'gemini-flash' })
    ).toBe('Image reply')
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body))
    expect(body.contents[0].parts).toContainEqual({
      inlineData: { mimeType: 'image/png', data: 'AQID' },
    })
  })
  it('sends image data to OpenRouter through the transport', async () => {
    const fetch = vi.fn<FetchFunction>(async () =>
      streamResponse(sse(['Image reply']))
    )
    const { client } = setup(fetch, DEFAULT_LLM_CONFIG, {
      'llm.openrouter': { origins: ['https://openrouter.ai'], available: true },
    })
    expect(
      await client.run('chat', imagePrompt, {
        modelId: 'openrouter-gpt-4-1-mini',
        onChunk: () => undefined,
      })
    ).toBe('Image reply')
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body))
    expect(body.messages[0].content).toContainEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AQID' },
    })
  })
})

it('rejects truncated streamed output and retains the text', async () => {
  const fetch = vi.fn<FetchFunction>(async () =>
    streamResponse(
      sse(['partial']).map((part) =>
        part.replace('"finish_reason":"stop"', '"finish_reason":"length"')
      )
    )
  )
  const config = structuredClone(DEFAULT_LLM_CONFIG)
  const { client } = setup(fetch, config)
  const chunks: string[] = []
  await expect(
    client.run('aiTask', prompt, { onChunk: (chunk) => chunks.push(chunk) })
  ).rejects.toMatchObject({ kind: 'output_truncated', partialText: 'partial' })
  expect(chunks).toEqual(['partial'])
  expect(fetch).toHaveBeenCalledOnce()
})

it('rejects truncated non-streamed output and preserves its partial text', async () => {
  const fetch = vi.fn<FetchFunction>(async () =>
    jsonResponse(200, {
      id: '1',
      object: 'chat.completion',
      created: 1,
      model: 'test',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'partial' },
          finish_reason: 'length',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
  )
  const { client } = setup(fetch)
  await expect(client.run('aiTask', prompt)).rejects.toMatchObject({
    kind: 'output_truncated',
    partialText: 'partial',
  })
})

it('times out a model that does not answer', async () => {
  const config = structuredClone(DEFAULT_LLM_CONFIG)
  const fetch = vi.fn<FetchFunction>(
    async (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          'abort',
          () => reject(options.signal?.reason),
          { once: true }
        )
      })
  )
  const client = createLlmClient({
    getConfig: () => config,
    keys: { get: async () => '' },
    timeoutMs: 30,
    transport: { fetch, openSocket: vi.fn() },
  })
  await expect(client.run('aiTask', prompt)).rejects.toMatchObject({
    kind: 'timeout',
  })
  expect(fetch).toHaveBeenCalledOnce()
})

it('sends the preserved DeepSeek thinking mode to the provider', async () => {
  const config = structuredClone(DEFAULT_LLM_CONFIG)
  config.models.find(
    (model) => model.id === 'deepseek-chat'
  )!.isThinkingEnabled = true
  const fetch = vi.fn<FetchFunction>(async () =>
    streamResponse(sse(['answer']))
  )
  const { client } = setup(fetch, config, {
    'llm.deepseek': { origins: ['https://api.deepseek.com'], available: true },
  })
  await client.run('chat', prompt, {
    modelId: 'deepseek-chat',
    onChunk: () => undefined,
  })
  const body = JSON.parse(String(fetch.mock.calls[0][1]?.body))
  expect(body.model).toBe('deepseek-flash')
  expect(body.thinking).toEqual({ type: 'enabled' })
})

function toolCallChunks(name: string) {
  return [
    `data: ${JSON.stringify({
      id: '1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'm',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call-1',
                type: 'function',
                function: { name, arguments: '{}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    })}\n\n`,
    'data: [DONE]\n\n',
  ]
}

/** The default config with its local model able to call tools */
function toolConfig() {
  const llm = structuredClone(DEFAULT_LLM_CONFIG)
  for (const model of llm.models) model.canUseTools = true
  return llm
}

const clock = () => ({
  now: dynamicTool({
    description: 'The current time',
    inputSchema: jsonSchema({ type: 'object', properties: {} }),
    execute: async () => '12:00',
  }),
})

async function collect(events: AsyncIterable<LlmStreamEvent>) {
  const out: LlmStreamEvent[] = []
  for await (const event of events) out.push(event)
  return out
}

/** Answers with a tool call first and with text once a tool result is sent */
function toolServer() {
  return vi.fn<FetchFunction>(async (_input, init) => {
    const body = JSON.parse(String(init?.body))
    const answered = body.messages.some(
      (message: { role: string }) => message.role === 'tool'
    )
    return streamResponse(
      answered ? sse(['It is ', 'noon.']) : toolCallChunks('now')
    )
  })
}

describe('llm-client stream', () => {
  it('runs the tool loop and reports every step', async () => {
    const fetch = toolServer()
    const { client } = setup(fetch, toolConfig())

    const events = await collect(
      client.stream('aiTask', prompt, { tools: clock(), maxSteps: 3 })
    )

    expect(events.map((event) => event.type)).toEqual([
      'model',
      'tool-call',
      'tool-result',
      'step-finish',
      'text',
      'text',
      'step-finish',
      'finish',
    ])
    expect(events.find((event) => event.type === 'tool-result')).toMatchObject({
      toolName: 'now',
      output: '12:00',
      isError: false,
    })
    const finish = events.at(-1)
    expect(finish).toMatchObject({ finishReason: 'stop', text: 'It is noon.' })
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body))
    expect(body.tools[0].function.name).toBe('now')
  })

  it('stops at an approval request and continues after the decision', async () => {
    const fetch = toolServer()
    const { client } = setup(fetch, toolConfig())
    const options = {
      tools: clock(),
      maxSteps: 3,
      toolApproval: { now: 'user-approval' as const },
    }

    const first = await collect(client.stream('aiTask', prompt, options))
    const request = first.find((event) => event.type === 'approval-request')
    const finish = first.at(-1)
    expect(request).toMatchObject({ toolName: 'now', input: {} })
    expect(finish).toMatchObject({ finishReason: 'tool-calls' })
    if (request?.type !== 'approval-request' || finish?.type !== 'finish')
      throw new Error('unreachable')

    const second = await collect(
      client.stream(
        'aiTask',
        {
          messages: [
            ...prompt.messages,
            ...finish.responseMessages,
            toolApprovalResponse({
              approvalId: request.approvalId,
              approved: true,
            }),
          ],
        },
        options
      )
    )
    expect(second.at(-1)).toMatchObject({
      finishReason: 'stop',
      text: 'It is noon.',
    })
  })

  it('fails as a step limit when the steps run out on tool calls', async () => {
    const fetch = vi.fn<FetchFunction>(async () =>
      streamResponse(toolCallChunks('now'))
    )
    const { client } = setup(fetch, toolConfig())

    await expect(
      collect(client.stream('aiTask', prompt, { tools: clock(), maxSteps: 1 }))
    ).rejects.toMatchObject({ kind: 'step_limit' })
  })

  it('reports a model that refuses tools', async () => {
    const fetch = vi.fn<FetchFunction>(async () =>
      jsonResponse(400, {
        error: { message: 'qwen2.5:7b does not support tools' },
      })
    )
    const { client } = setup(fetch, toolConfig())

    const error = await collect(
      client.stream('aiTask', prompt, { tools: clock(), maxSteps: 2 })
    ).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ kind: 'tools_unsupported' })
  })

  it('ends without a finish when aborted', async () => {
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
    const events: LlmStreamEvent[] = []

    for await (const event of client.stream('aiTask', prompt, {
      signal: controller.signal,
    })) {
      events.push(event)
      if (event.type === 'text') controller.abort()
    }

    expect(events.map((event) => event.type)).toEqual(['model', 'text'])
  })
})
