import type { PluginContext, PluginManifest } from '@tyco/plugin-sdk'
import { reactive } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { PluginTransport } from './plugin-rpc'
import { activatePluginSandbox } from './plugin-sandbox'

vi.mock('../desktop/window', () => ({
  convertFileSrc: (path: string) =>
    `tyco-plugin://localhost/${encodeURIComponent(path)}`,
}))

describe('plugin-sandbox', () => {
  const createManifest = (): PluginManifest => ({
    id: 'Example',
    version: '1.0.0',
    apiVersion: 2,
    capabilities: [],
    defaultLocale: 'en_US',
    locales: {
      en_US: { label: 'Example' },
      ru_RU: { label: 'Example' },
      es_AR: { label: 'Example' },
      tr_TR: { label: 'Example' },
    },
  })

  it('sends cloneable snapshots and closes the transport on disposal', async () => {
    const manifest = reactive<PluginManifest>(createManifest())
    let receive: (value: unknown) => void = () => {}
    const sent: unknown[] = []
    const close = vi.fn()
    const transport: PluginTransport = {
      listen: (handler) => {
        receive = handler
        return vi.fn()
      },
      close,
      send: (message) => {
        const cloned = structuredClone(message) as { type: string; id: number }
        sent.push(cloned)
        if (cloned.type === 'request')
          queueMicrotask(() => receive({ type: 'result', id: cloned.id }))
      },
    }
    let dispose: () => void | Promise<void> = () => {}
    const context = {
      signal: new AbortController().signal,
      getMyConfig: () => reactive({ nested: { enabled: true } }),
      onDispose: (cleanup: () => void | Promise<void>) => {
        dispose = cleanup
      },
    } as unknown as PluginContext
    const failure = vi.fn()
    await activatePluginSandbox(
      manifest,
      '4578616d706c65/1.js',
      context,
      failure,
      async () => transport
    )
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'load',
          args: expect.objectContaining({
            manifest: JSON.parse(JSON.stringify(manifest)),
          }),
        }),
        expect.objectContaining({
          method: 'init',
          args: expect.objectContaining({
            config: { nested: { enabled: true } },
          }),
        }),
      ])
    )
    await dispose()
    expect(close).toHaveBeenCalledOnce()
    expect(failure).not.toHaveBeenCalled()
  })

  it('closes transport and rejects when signal is already aborted', async () => {
    const manifest = createManifest()
    const close = vi.fn()
    const transport: PluginTransport = {
      listen: () => vi.fn(),
      close,
      send: vi.fn(),
    }

    const controller = new AbortController()
    controller.abort()

    const context = {
      signal: controller.signal,
      onDispose: vi.fn(),
    } as unknown as PluginContext

    await expect(
      activatePluginSandbox(
        manifest,
        'test.js',
        context,
        vi.fn(),
        async () => transport
      )
    ).rejects.toThrow('Plugin activation cancelled')

    expect(close).toHaveBeenCalledOnce()
  })

  it('handles host method invocation like log and validates argument contracts', async () => {
    const manifest = createManifest()
    let receive: (value: unknown) => void = () => {}
    const close = vi.fn()

    const transport: PluginTransport = {
      listen: (handler) => {
        receive = handler
        return vi.fn()
      },
      close,
      send: (message) => {
        const msg = message as { type: string; id: number; method?: string }
        if (
          msg.type === 'request' &&
          (msg.method === 'load' || msg.method === 'init')
        ) {
          queueMicrotask(() => receive({ type: 'result', id: msg.id }))
        }
      },
    }

    const logMock = vi.fn()
    const context = {
      signal: new AbortController().signal,
      getMyConfig: () => ({}),
      log: logMock,
      onDispose: vi.fn(),
    } as unknown as PluginContext

    await activatePluginSandbox(
      manifest,
      'test.js',
      context,
      vi.fn(),
      async () => transport
    )

    // Simulate incoming host method call from plugin worker: log('info', 'Plugin started')
    receive({
      type: 'host',
      id: 99,
      method: 'log',
      args: ['info', 'Plugin started'],
    })

    await new Promise((r) => setTimeout(r, 10))
    expect(logMock).toHaveBeenCalledWith('info', 'Plugin started')
  })
})
