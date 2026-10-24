import { expect } from '@playwright/test'
import { LLM_TASKS, type DesktopChannel } from '@tyco/shared'

import type { FakeDesktop } from './fake-desktop'

/** A controlled OpenAI-compatible server at the native network boundary. */
export function installLlm(desktop: FakeDesktop, seedConfig = true) {
  if (seedConfig) {
    desktop.userConfig.llm.providers.push({
      id: 'browser-test',
      type: 'openaiCompatible',
      name: 'Browser test',
      baseUrl: 'http://llm.invalid/v1',
    })
    desktop.userConfig.llm.models = [
      {
        id: 'browser-model',
        providerId: 'browser-test',
        providerModelId: 'browser-model',
        canUseImages: false,
        canUseTools: false,
        name: 'Browser model',
      },
    ]
    for (const task of LLM_TASKS) {
      desktop.userConfig.llm.tasks[task].modelId = 'browser-model'
    }
    desktop.sessionState.lastChatModelId = 'browser-model'
  }
  const requests: Array<{
    channel: DesktopChannel
    body: string
    url: string
  }> = []
  desktop.handle('start_fetch', ({ request, onEvent }) => {
    requests.push({
      channel: onEvent,
      body: Buffer.from(request.body ?? '', 'base64').toString(),
      url: request.url,
    })
    return requests.length
  })
  desktop.handle('acknowledge_fetch_chunk', () => undefined)
  desktop.handle('cancel_net_task', () => undefined)

  const requestAt = async (index: number) => {
    await expect.poll(() => requests.length).toBeGreaterThan(index)
    const request = requests[index]!
    expect(request.url).toBe('http://llm.invalid/v1/chat/completions')
    return request
  }
  const send = (channel: DesktopChannel, value: unknown) =>
    desktop.sendChannel(
      channel,
      new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`)
    )
  return {
    requests,
    async answer(text: string, index = 0) {
      const { channel, body } = await requestAt(index)
      expect(JSON.parse(body).stream).not.toBe(true)
      await desktop.sendChannel(channel, {
        type: 'head',
        status: 200,
        statusText: 'OK',
        headers: [['content-type', 'application/json']],
      })
      await desktop.sendChannel(
        channel,
        new TextEncoder().encode(
          JSON.stringify({
            id: 'browser-response',
            object: 'chat.completion',
            created: 1,
            model: 'browser-model',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: text },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 10,
              total_tokens: 20,
            },
          })
        )
      )
      await desktop.sendChannel(channel, { type: 'end' })
    },
    async start(index = 0) {
      const { channel } = await requestAt(index)
      await desktop.sendChannel(channel, {
        type: 'head',
        status: 200,
        statusText: 'OK',
        headers: [['content-type', 'text/event-stream']],
      })
    },
    async toolCall(name: string, input: Record<string, unknown>, index = 0) {
      const { channel } = await requestAt(index)
      await send(channel, {
        id: 'browser-tool-response',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'browser-model',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'browser-call',
                  type: 'function',
                  function: { name, arguments: JSON.stringify(input) },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      })
      await send(channel, {
        id: 'browser-tool-response',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'browser-model',
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      })
      await desktop.sendChannel(
        channel,
        new TextEncoder().encode('data: [DONE]\n\n')
      )
      await desktop.sendChannel(channel, { type: 'end' })
    },
    async chunk(text: string, index = 0) {
      const { channel } = await requestAt(index)
      await send(channel, {
        id: 'browser-response',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'browser-model',
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: text },
            finish_reason: null,
          },
        ],
      })
    },
    async finish(index = 0) {
      const { channel } = await requestAt(index)
      await send(channel, {
        id: 'browser-response',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'browser-model',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      })
      await desktop.sendChannel(
        channel,
        new TextEncoder().encode('data: [DONE]\n\n')
      )
      await desktop.sendChannel(channel, { type: 'end' })
    },
    async fail(index = 0) {
      const { channel } = await requestAt(index)
      await desktop.sendChannel(channel, {
        type: 'head',
        status: 401,
        statusText: 'Unauthorized',
        headers: [['content-type', 'application/json']],
      })
      await desktop.sendChannel(
        channel,
        new TextEncoder().encode(
          JSON.stringify({
            error: {
              message: 'Browser test authorization denied',
              type: 'invalid_request_error',
            },
          })
        )
      )
      await desktop.sendChannel(channel, { type: 'end' })
    },
  }
}
