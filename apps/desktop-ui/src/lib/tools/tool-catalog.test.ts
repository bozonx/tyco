import { nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildToolCatalog, createToolCatalogSync } from './tool-catalog'
import { createToolRegistry } from './tool-registry'
import {
  NO_INPUT_SCHEMA,
  TEXT_INPUT_SCHEMA,
  type ToolDefinition,
} from './tool-types'

const tool = (
  id: string,
  extra: Partial<ToolDefinition> = {}
): ToolDefinition => ({
  id,
  description: id,
  inputSchema: TEXT_INPUT_SCHEMA,
  run: async () => ({ ok: true }),
  ...extra,
})

const structured = {
  type: 'object' as const,
  properties: { at: { type: 'string' as const } },
}

describe('buildToolCatalog', () => {
  it('describes the input and the availability of each tool', () => {
    const registry = createToolRegistry([
      tool('script'),
      tool('core.translate', { getUnavailableReasonKey: () => 'reason.noLlm' }),
    ])
    registry.registerPluginTools('Home', [
      tool('lights', { inputSchema: NO_INPUT_SCHEMA }),
      tool('remind', {
        inputSchema: structured,
        parseText: async () => ({ ok: true, input: {} }),
      }),
      tool('todo', { inputSchema: structured }),
    ])
    expect(buildToolCatalog(registry.list(), (key) => `t:${key}`)).toEqual([
      {
        id: 'script',
        input: 'text',
        available: true,
        inputSchema: TEXT_INPUT_SCHEMA,
      },
      {
        id: 'core.translate',
        input: 'text',
        available: false,
        reason: 't:reason.noLlm',
        inputSchema: TEXT_INPUT_SCHEMA,
      },
      {
        id: 'Home.lights',
        input: 'none',
        available: true,
        inputSchema: NO_INPUT_SCHEMA,
      },
      {
        id: 'Home.remind',
        input: 'parsed',
        available: true,
        inputSchema: structured,
      },
      {
        id: 'Home.todo',
        input: 'structured',
        available: true,
        inputSchema: structured,
      },
    ])
  })
})

describe('createToolCatalogSync', () => {
  afterEach(() => vi.useRealTimers())
  it('sends the catalog on start and again only when it changes', async () => {
    const registry = createToolRegistry([tool('script')])
    const llmReady = ref(false)
    registry.registerCoreTools([
      tool('core.correct', {
        getUnavailableReasonKey: () => (llmReady.value ? undefined : 'noLlm'),
      }),
    ])
    const send = vi.fn()
    const sync = createToolCatalogSync({
      tools: () => registry.list(),
      t: (key) => key,
      send,
      reportError: vi.fn(),
    })
    sync.start()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toHaveLength(2)

    registry.registerPluginTools('Notes', [tool('write')])
    await nextTick()
    expect(send).toHaveBeenCalledTimes(2)
    expect(
      send.mock.calls[1][0].map((entry: { id: string }) => entry.id)
    ).toEqual(['script', 'core.correct', 'Notes.write'])

    // the plugins load again with the same tools
    registry.unregisterPlugin('Notes')
    registry.registerPluginTools('Notes', [tool('write')])
    await nextTick()
    expect(send).toHaveBeenCalledTimes(2)

    llmReady.value = true
    await nextTick()
    expect(send).toHaveBeenCalledTimes(3)
    expect(send.mock.calls[2][0][1]).toEqual({
      id: 'core.correct',
      inputSchema: TEXT_INPUT_SCHEMA,
      input: 'text',
      available: true,
    })

    sync.dispose()
    registry.unregisterPlugin('Notes')
    await nextTick()
    expect(send).toHaveBeenCalledTimes(3)
  })
})

describe('catalog delivery failures', () => {
  afterEach(() => vi.useRealTimers())
  it('retries an unchanged catalog after a failure and cancels retries on disposal', async () => {
    vi.useFakeTimers()
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValue(undefined)
    const reportError = vi.fn()
    const sync = createToolCatalogSync({
      tools: () => [],
      t: (key) => key,
      send,
      reportError,
      retryMs: 100,
    })
    sync.start()
    await Promise.resolve()
    expect(reportError).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(100)
    expect(send).toHaveBeenCalledTimes(2)
    sync.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('serializes sends and delivers the latest catalog after an in-flight send', async () => {
    const registry = createToolRegistry([tool('first')])
    let finish!: () => void
    const send = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve
          })
      )
      .mockResolvedValue(undefined)
    const sync = createToolCatalogSync({
      tools: () => registry.list(),
      t: (key) => key,
      send,
      reportError: vi.fn(),
    })
    sync.start()
    registry.registerCoreTools([tool('second')])
    await nextTick()
    expect(send).toHaveBeenCalledTimes(1)
    finish()
    await Promise.resolve()
    expect(send).toHaveBeenCalledTimes(2)
    expect(
      send.mock.calls[1][0].map((entry: { id: string }) => entry.id)
    ).toEqual(['first', 'second'])
    sync.dispose()
  })

  it('does not retry a pending send that fails after disposal', async () => {
    vi.useFakeTimers()
    let fail!: (error: Error) => void
    const send = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject
        })
    )
    const reportError = vi.fn()
    const sync = createToolCatalogSync({
      tools: () => [],
      t: (key) => key,
      send,
      reportError,
    })
    sync.start()
    sync.dispose()
    fail(new Error('Unavailable'))
    await Promise.resolve()
    expect(vi.getTimerCount()).toBe(0)
    expect(reportError).not.toHaveBeenCalled()
  })
})
