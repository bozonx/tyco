import type { PluginContext, PluginManifest } from '@tyco/plugin-sdk'
import { nextTick, reactive } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../i18n'
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
    defaultLocale: 'en-US',
    locales: {
      'en-US': { label: 'Example' },
      'ru-RU': { label: 'Example' },
      'es-AR': { label: 'Example' },
      'tr-TR': { label: 'Example' },
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

  describe('host bridge', () => {
    type Sent = {
      type: string
      id?: number
      method?: string
      args?: unknown
      result?: unknown
      error?: { message: string }
      messages?: unknown
    }

    /**
     * A worker stand-in: answers lifecycle requests and records what the host
     * sends, so a test can play host calls and read their results
     */
    function createHarness(context: Record<string, unknown> = {}) {
      let receive: (value: unknown) => void = () => {}
      const sent: Sent[] = []
      const close = vi.fn()
      const failLoad = { value: false }
      const transport: PluginTransport = {
        listen: (handler) => {
          receive = handler
          return vi.fn()
        },
        close,
        send: (message) => {
          const msg = structuredClone(message) as Sent
          sent.push(msg)
          if (
            msg.type === 'request' &&
            ['load', 'init', 'dispose'].includes(msg.method ?? '')
          )
            queueMicrotask(() =>
              receive(
                failLoad.value && msg.method === 'load'
                  ? { type: 'result', id: msg.id, error: { message: 'Broken' } }
                  : { type: 'result', id: msg.id }
              )
            )
        },
      }
      const controller = new AbortController()
      let dispose: () => Promise<void> = async () => {}
      const ctx = {
        signal: controller.signal,
        getMyConfig: () => ({}),
        onDispose: (cleanup: () => Promise<void>) => {
          dispose = cleanup
        },
        ...context,
      } as unknown as PluginContext
      const failure = vi.fn()
      let hostId = 1000
      async function callHost(method: string, args: unknown[]) {
        const id = ++hostId
        receive({ type: 'host', id, method, args })
        await vi.waitFor(() => {
          if (!sent.some((m) => m.type === 'host-result' && m.id === id))
            throw new Error('No host result yet')
        })
        return sent.find((m) => m.type === 'host-result' && m.id === id)!
      }
      return {
        sent,
        close,
        failLoad,
        controller,
        failure,
        callHost,
        receive: (value: unknown) => receive(value),
        dispose: () => dispose(),
        activate: () =>
          activatePluginSandbox(
            createManifest(),
            'test.js',
            ctx,
            failure,
            async () => transport
          ),
      }
    }

    afterEach(() => {
      i18n.global.locale.value = 'en-US'
    })

    it.each<[string, unknown[], string]>([
      ['toEditor', [42], 'Invalid editor argument'],
      ['setEditorInputValue', [{}], 'Invalid editor argument'],
      ['toast', ['Saved', 'loud'], 'Invalid notification arguments'],
      ['toastText', [1, 'info'], 'Invalid notification arguments'],
      ['log', ['trace', 'Message'], 'Invalid log arguments'],
      ['log', ['info', 1], 'Invalid log arguments'],
      ['openDevTools', [], 'Unknown plugin host method'],
      ['callback', [77, []], 'Unknown host callback'],
    ])('rejects %s with invalid arguments', async (method, args, message) => {
      const harness = createHarness({
        toEditor: vi.fn(),
        setEditorInputValue: vi.fn(),
        toast: vi.fn(),
        toastText: vi.fn(),
        log: vi.fn(),
      })
      await harness.activate()
      const result = await harness.callHost(method, args)
      expect(result.error?.message).toBe(message)
    })

    it('passes valid editor and notification calls through', async () => {
      const toEditor = vi.fn()
      const toast = vi.fn()
      const harness = createHarness({ toEditor, toast })
      await harness.activate()
      expect((await harness.callHost('toEditor', ['Text'])).error).toBe(
        undefined
      )
      expect((await harness.callHost('toast', ['Done', 'success'])).error).toBe(
        undefined
      )
      expect(toEditor).toHaveBeenCalledWith('Text')
      expect(toast).toHaveBeenCalledWith('Done', 'success')
    })

    it('exposes returned host functions as callbacks to the plugin', async () => {
      const disposer = vi.fn(() => 'removed')
      const harness = createHarness({ registerTools: vi.fn(() => disposer) })
      await harness.activate()
      const registered = await harness.callHost('registerTools', [[]])
      const callbackId = (registered.result as { $callback: number }).$callback
      expect(callbackId).toBeGreaterThan(0)

      const first = await harness.callHost('callback', [callbackId, []])
      expect(first.result).toBe('removed')
      expect(disposer).toHaveBeenCalledOnce()
      // registration disposers are single-use
      const second = await harness.callHost('callback', [callbackId, []])
      expect(second.error?.message).toBe('Unknown host callback')
    })

    it('invokes plugin callbacks through the worker and decodes the answer', async () => {
      let pluginCallback: ((...args: unknown[]) => Promise<unknown>) | null =
        null
      const harness = createHarness({
        callApiFunction: vi.fn((_name: string, run: typeof pluginCallback) => {
          pluginCallback = run
        }),
      })
      await harness.activate()
      await harness.callHost('callApiFunction', ['run', { $callback: 5 }])
      expect(pluginCallback).toBeTypeOf('function')

      const answer = pluginCallback!('input', {
        signal: new AbortController().signal,
        onChunk: () => {},
      })
      await vi.waitFor(() => {
        if (!harness.sent.some((m) => m.method === 'invoke'))
          throw new Error('No invoke yet')
      })
      const invoke = harness.sent.find((m) => m.method === 'invoke')!
      expect(invoke.args).toEqual(
        expect.objectContaining({
          callback: 5,
          args: ['input', { onChunk: { $callback: 1 }, $signal: true }],
        })
      )
      harness.receive({ type: 'result', id: invoke.id, result: 'output' })
      await expect(answer).resolves.toBe('output')
      // callbacks of the finished call are released
      const stale = await harness.callHost('callback', [1, []])
      expect(stale.error?.message).toBe('Unknown host callback')
    })

    it('pushes new messages to the worker when the locale changes', async () => {
      const harness = createHarness()
      await harness.activate()
      i18n.global.locale.value = 'ru-RU'
      await nextTick()
      expect(harness.sent.some((m) => m.type === 'messages')).toBe(true)
    })

    it('aborts pending work and stays silent about failures after abort', async () => {
      const harness = createHarness()
      await harness.activate()
      harness.controller.abort()
      expect(harness.sent.at(-1)).toEqual({ type: 'abort' })
      const result = await harness.callHost('log', ['info', 'Late'])
      expect(result.error?.message).toBe('Plugin host request is not active')
      harness.receive({ type: 'fatal' })
      expect(harness.failure).not.toHaveBeenCalled()
    })

    it('reports worker failures while active', async () => {
      const harness = createHarness()
      await harness.activate()
      harness.receive({ type: 'fatal' })
      expect(harness.failure).toHaveBeenCalledWith(
        new Error('Plugin worker failed')
      )
    })

    it('closes the runtime when loading the plugin fails', async () => {
      const harness = createHarness()
      harness.failLoad.value = true
      await expect(harness.activate()).rejects.toThrow('Broken')
      expect(harness.close).toHaveBeenCalledOnce()
    })

    it('asks the worker to dispose and clears callbacks', async () => {
      const harness = createHarness({ registerTools: vi.fn(() => () => {}) })
      await harness.activate()
      await harness.callHost('registerTools', [[]])
      await harness.dispose()
      expect(harness.sent.some((m) => m.method === 'dispose')).toBe(true)
      expect(harness.close).toHaveBeenCalledOnce()
    })
  })

  describe('iframe transport', () => {
    function stubDocument(reply: 'ready' | 'silent') {
      const frames: Array<Record<string, unknown>> = []
      vi.stubGlobal('document', {
        createElement: () => {
          const frame: Record<string, unknown> = {
            attributes: {} as Record<string, string>,
            setAttribute(name: string, value: string) {
              ;(frame.attributes as Record<string, string>)[name] = value
            },
            remove: vi.fn(),
            contentWindow: {
              postMessage: (
                _message: unknown,
                _origin: string,
                [port]: MessagePort[]
              ) => {
                if (reply === 'ready') port.postMessage({ type: 'ready' })
              },
            },
          }
          frames.push(frame)
          return frame
        },
        body: {
          append: (frame: { onload: () => void }) => {
            frame.onload()
            // a reload must not try to transfer the port again
            frame.onload()
          },
        },
      })
      return frames
    }

    it('connects a sandboxed frame and resolves once the worker is ready', async () => {
      const frames = stubDocument('ready')
      let dispose: () => Promise<void> = async () => {}
      // the stub worker never answers load, so the test cancels activation
      const controller = new AbortController()
      const ctx = {
        signal: controller.signal,
        onDispose: (cleanup: () => Promise<void>) => {
          dispose = cleanup
        },
      } as unknown as PluginContext
      const activation = activatePluginSandbox(
        createManifest(),
        'test.js',
        ctx,
        vi.fn()
      )
      await vi.waitFor(() => {
        if (frames.length === 0) throw new Error('No frame yet')
      })
      expect(frames[0]).toMatchObject({
        hidden: true,
        attributes: { sandbox: 'allow-scripts allow-same-origin' },
        src: expect.stringContaining('index.html'),
      })
      await new Promise((resolve) => setTimeout(resolve, 20))
      controller.abort()
      await expect(activation).rejects.toThrow('Plugin lifetime ended')
      // an aborted lifetime skips the dispose request but still tears down
      await expect(dispose()).rejects.toThrow('Plugin request cancelled')
      expect(frames[0]!.remove).toHaveBeenCalled()
    })

    it('gives up when the frame never reports ready', async () => {
      vi.useFakeTimers()
      try {
        const frames = stubDocument('silent')
        const activation = activatePluginSandbox(
          createManifest(),
          'test.js',
          {
            signal: new AbortController().signal,
            onDispose: vi.fn(),
          } as unknown as PluginContext,
          vi.fn()
        )
        const assertion = expect(activation).rejects.toThrow(
          'Plugin sandbox failed to start'
        )
        await vi.advanceTimersByTimeAsync(5000)
        await assertion
        expect(frames[0]!.remove).toHaveBeenCalledOnce()
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
