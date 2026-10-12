import type { ChatImage, ChatMessage } from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'

import { LlmError } from './llm-client'
import { createLlmRequest } from './llm-request'

function setup() {
  const deps = {
    client: { run: vi.fn().mockResolvedValue('answer') },
    getImage: vi.fn(async () => new Uint8Array([1, 2, 3])),
    rulePrefix: () => 'Rules',
    translate: (key: string) => key,
    logError: vi.fn(),
    notifyError: vi.fn(),
  }
  return { deps, request: createLlmRequest(deps) }
}

const image: ChatImage = {
  id: 'image-1',
  mediaType: 'image/png',
  width: 1,
  height: 1,
  size: 3,
}

describe('LLM request', () => {
  it('builds the prompt and forwards streaming, cancellation and model selection', async () => {
    const { deps, request } = setup()
    const signal = new AbortController().signal
    const onChunk = vi.fn()
    const onModel = vi.fn()
    expect(
      await request('chat', 'question', {
        instructions: 'Answer briefly',
        rules: 'Use plain text',
        models: ['chosen-model'],
        signal,
        onChunk,
        onModel,
      })
    ).toBe('answer')
    expect(deps.client.run).toHaveBeenCalledWith(
      'chat',
      {
        system: 'Answer briefly\n\nRules:\n\nUse plain text',
        messages: [{ role: 'user', content: 'question' }],
      },
      { models: ['chosen-model'], signal, onChunk, onModel }
    )
  })

  it('loads each image once per request, including images reused across turns', async () => {
    const { deps, request } = setup()
    const messages: ChatMessage[] = [
      { role: 'user', content: 'first', images: [image] },
      { role: 'user', content: 'second', images: [image] },
    ]
    await request('chat', messages)
    expect(deps.getImage).toHaveBeenCalledExactlyOnceWith(image.id)
    const prompt = deps.client.run.mock.calls[0][1]
    expect(prompt.messages[0].content[1]).toEqual({
      type: 'file',
      data: new Uint8Array([1, 2, 3]),
      mediaType: 'image/png',
    })
    expect(prompt.messages[1].content[1]).toEqual(prompt.messages[0].content[1])
  })

  it('reports missing images without contacting the provider', async () => {
    const { deps, request } = setup()
    deps.getImage.mockRejectedValue(new Error('File missing'))
    await expect(
      request('chat', [{ role: 'user', content: '', images: [image] }])
    ).rejects.toMatchObject({
      kind: 'unknown',
      message: 'chat.imageUnavailable',
    })
    expect(deps.client.run).not.toHaveBeenCalled()
    expect(deps.notifyError).toHaveBeenCalledWith(
      'llmErrors.unknown\nchat.imageUnavailable'
    )
  })

  it('preserves typed failures and lets callers suppress duplicate notifications', async () => {
    const { deps, request } = setup()
    const error = new LlmError('auth', 'Invalid credentials')
    deps.client.run.mockRejectedValue(error)
    await expect(
      request('chat', 'question', { notifyError: false })
    ).rejects.toBe(error)
    expect(deps.logError).toHaveBeenCalledWith(
      'LLM request "chat" failed',
      error
    )
    expect(deps.notifyError).not.toHaveBeenCalled()
  })

  it('normalizes unexpected failures before notifying and rethrowing', async () => {
    const { deps, request } = setup()
    deps.client.run.mockRejectedValue(new Error('Unexpected failure'))
    await expect(request('chat', 'question')).rejects.toBeInstanceOf(LlmError)
    expect(deps.notifyError).toHaveBeenCalledOnce()
  })

  it('does not load images or start a request that is already cancelled', async () => {
    const { deps, request } = setup()
    const controller = new AbortController()
    controller.abort()
    expect(
      await request('chat', [{ role: 'user', content: '', images: [image] }], {
        signal: controller.signal,
      })
    ).toBe('')
    expect(deps.getImage).not.toHaveBeenCalled()
    expect(deps.client.run).not.toHaveBeenCalled()
  })

  it('does not contact the provider when cancelled while an image loads', async () => {
    const { deps, request } = setup()
    const controller = new AbortController()
    deps.getImage.mockImplementation(async () => {
      controller.abort()
      return new Uint8Array([1])
    })
    expect(
      await request('chat', [{ role: 'user', content: '', images: [image] }], {
        signal: controller.signal,
      })
    ).toBe('')
    expect(deps.client.run).not.toHaveBeenCalled()
  })

  it('suppresses errors from an aborted provider request', async () => {
    const { deps, request } = setup()
    const controller = new AbortController()
    deps.client.run.mockImplementation(async () => {
      controller.abort()
      throw new Error('Cancelled')
    })
    expect(
      await request('chat', 'question', { signal: controller.signal })
    ).toBe('')
    expect(deps.logError).not.toHaveBeenCalled()
    expect(deps.notifyError).not.toHaveBeenCalled()
  })
})
