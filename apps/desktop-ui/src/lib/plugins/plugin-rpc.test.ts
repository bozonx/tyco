import { describe, expect, it, vi } from 'vitest'
import { createPluginRpc } from './plugin-rpc'

function setup(timeoutMs = 1000) {
  let receive!: (message: unknown) => void
  const send = vi.fn()
  const close = vi.fn()
  const callHost = vi.fn(async () => 'host-result')
  const onFailure = vi.fn()
  const rpc = createPluginRpc({
    transport: {
      send,
      close,
      listen: (handler) => {
        receive = handler
        return vi.fn()
      },
    },
    callHost,
    onFailure,
    timeoutMs,
  })
  return {
    rpc,
    receive: (message: unknown) => receive(message),
    send,
    close,
    callHost,
    onFailure,
  }
}
describe('plugin RPC', () => {
  it('accepts responses only for pending requests', async () => {
    const { rpc, receive } = setup()
    const pending = rpc.request('load', {})
    receive({ type: 'result', id: 999, result: 'forged' })
    receive({ type: 'result', id: 1, result: 'loaded' })
    expect(await pending).toBe('loaded')
    rpc.close()
  })
  it('allows host calls only during an active invocation, never package loading', async () => {
    const { rpc, receive, callHost, send } = setup()
    const loading = rpc.request('load', {})
    receive({
      type: 'host',
      id: 10,
      requestId: 1,
      method: 'setEditorInputValue',
      args: ['forged'],
    })
    expect(callHost).not.toHaveBeenCalled()
    receive({ type: 'result', id: 1 })
    await loading
    const initialization = rpc.request('init', {})
    receive({
      type: 'host',
      id: 11,
      requestId: 2,
      method: 'registerTools',
      args: [[]],
    })
    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'host-result',
        id: 11,
        result: 'host-result',
      })
    )
    receive({ type: 'result', id: 2 })
    await initialization
    rpc.close()
  })
  it('cancels a caller and ignores late effects from that invocation', async () => {
    const { rpc, receive, callHost, send } = setup()
    const controller = new AbortController()
    const running = rpc.request('invoke', {}, controller.signal)
    const rejected = expect(running).rejects.toMatchObject({
      code: 'tyco-plugin-cancelled',
    })
    controller.abort()
    await rejected
    expect(send).toHaveBeenCalledWith({ type: 'cancel', id: 1 })
    receive({
      type: 'host',
      id: 10,
      requestId: 1,
      method: 'setEditorInputValue',
      args: ['late'],
    })
    expect(callHost).not.toHaveBeenCalled()
    rpc.close()
  })
  it('terminates a timed out worker and rejects all waiting requests', async () => {
    vi.useFakeTimers()
    try {
      const { rpc, close, onFailure } = setup(100)
      const first = expect(rpc.request('invoke', {})).rejects.toThrow(
        'timed out'
      )
      const second = expect(rpc.request('invoke', {})).rejects.toThrow(
        'timed out'
      )
      await vi.advanceTimersByTimeAsync(100)
      await Promise.all([first, second])
      expect(close).toHaveBeenCalledOnce()
      expect(onFailure).toHaveBeenCalledOnce()
      await expect(rpc.request('init', {})).rejects.toMatchObject({
        code: 'tyco-plugin-cancelled',
      })
    } finally {
      vi.useRealTimers()
    }
  })
  it('fails a slow call alone when its timeout is not fatal', async () => {
    vi.useFakeTimers()
    try {
      const { rpc, close, onFailure, send } = setup(100)
      const slow = expect(
        rpc.request('invoke', {}, undefined, 100, { fatalTimeout: false })
      ).rejects.toThrow('timed out')
      await vi.advanceTimersByTimeAsync(100)
      await slow
      expect(send).toHaveBeenCalledWith({ type: 'cancel', id: 1 })
      expect(close).not.toHaveBeenCalled()
      expect(onFailure).not.toHaveBeenCalled()
      rpc.close()
    } finally {
      vi.useRealTimers()
    }
  })
})

it('terminates a cancelled worker that never acknowledges completion', async () => {
  vi.useFakeTimers()
  try {
    const { rpc, close, onFailure } = setup()
    const controller = new AbortController()
    const cancelled = expect(
      rpc.request('invoke', {}, controller.signal)
    ).rejects.toMatchObject({ code: 'tyco-plugin-cancelled' })
    controller.abort()
    await cancelled
    await vi.advanceTimersByTimeAsync(1500)
    expect(close).toHaveBeenCalledOnce()
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Plugin cancellation timed out' })
    )
  } finally {
    vi.useRealTimers()
  }
})

it('rejects inactive host calls explicitly and admits background calls after initialization', async () => {
  const { rpc, receive, send, callHost } = setup()
  receive({ type: 'host', id: 1, method: 'toastText', args: ['early', 'info'] })
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'host-result',
      id: 1,
      error: expect.any(Object),
    })
  )
  const init = rpc.request('init', {})
  receive({ type: 'result', id: 1 })
  await init
  receive({
    type: 'host',
    id: 2,
    method: 'toastText',
    args: ['background', 'info'],
  })
  await vi.waitFor(() =>
    expect(callHost).toHaveBeenCalledWith('toastText', ['background', 'info'])
  )
  rpc.close()
})

it('limits unresolved host requests and fails the peer before flooding services', async () => {
  const { rpc, receive, callHost, close } = setup()
  vi.mocked(callHost).mockImplementation(() => new Promise(() => {}))
  const init = rpc.request('init', {})
  receive({ type: 'result', id: 1 })
  await init
  for (let id = 1; id <= 65; id++)
    receive({
      type: 'host',
      id,
      method: 'toastText',
      args: ['message', 'info'],
    })
  expect(close).toHaveBeenCalledOnce()
  rpc.close()
})

describe('plugin RPC messages', () => {
  it('fails the peer on malformed messages and ignores noise', () => {
    const { rpc, receive, close, onFailure } = setup()
    receive(null)
    receive('text')
    receive({ type: 'result', id: 'one' })
    expect(onFailure).not.toHaveBeenCalled()
    receive({ type: 'result', id: 1, result: () => {} })
    expect(close).toHaveBeenCalledOnce()
    expect(onFailure).toHaveBeenCalledOnce()
    // a closed channel neither fails again nor reacts
    receive({ type: 'fatal' })
    expect(onFailure).toHaveBeenCalledOnce()
    rpc.close()
    expect(close).toHaveBeenCalledOnce()
  })

  it('reports cleanup errors without failing the peer', () => {
    const onCleanupError = vi.fn()
    const onFailure = vi.fn()
    let receive!: (message: unknown) => void
    createPluginRpc({
      transport: {
        send: vi.fn(),
        close: vi.fn(),
        listen: (handler) => {
          receive = handler
          return vi.fn()
        },
      },
      callHost: vi.fn(),
      onFailure,
      onCleanupError,
    })
    receive({ type: 'cleanup-error', error: { message: 'Leak' } })
    receive({ type: 'cleanup-error' })
    expect(onCleanupError.mock.calls).toEqual([
      [new Error('Leak')],
      [new Error('Plugin cleanup failed')],
    ])
    expect(onFailure).not.toHaveBeenCalled()
  })

  it('fails on a fatal worker report', async () => {
    const { rpc, receive, onFailure } = setup()
    const pending = expect(rpc.request('invoke', {})).rejects.toThrow(
      'Plugin worker failed'
    )
    receive({ type: 'fatal' })
    await pending
    expect(onFailure).toHaveBeenCalledWith(new Error('Plugin worker failed'))
  })

  it('rejects requests with the error the worker reports', async () => {
    const { rpc, receive } = setup()
    const pending = rpc.request('invoke', {})
    receive({
      type: 'result',
      id: 1,
      error: { message: 'Bad input', code: 'E_INPUT', messageKey: 'errors.x' },
    })
    await expect(pending).rejects.toMatchObject({
      message: 'Bad input',
      code: 'E_INPUT',
      messageKey: 'errors.x',
    })
    rpc.close()
  })

  it('returns host errors to the worker', async () => {
    const { rpc, receive, send, callHost } = setup()
    vi.mocked(callHost).mockRejectedValue(new Error('Denied'))
    const invoke = rpc.request('invoke', {})
    receive({ type: 'host', id: 7, requestId: 1, method: 'toast', args: [] })
    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'host-result',
        id: 7,
        error: { message: 'Denied' },
      })
    )
    receive({ type: 'result', id: 1 })
    await invoke
    rpc.close()
  })

  it('rejects malformed host calls and duplicate host ids', async () => {
    const { rpc, receive, send, callHost, onFailure } = setup()
    vi.mocked(callHost).mockImplementation(() => new Promise(() => {}))
    const invoke = rpc.request('invoke', {})
    receive({ type: 'host', id: 3, requestId: 1, method: 'log', args: 'x' })
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'host-result', id: 3 })
    )
    receive({ type: 'host', id: 4, requestId: 1, method: 'log', args: [] })
    receive({ type: 'host', id: 4, requestId: 1, method: 'log', args: [] })
    expect(onFailure).toHaveBeenCalledWith(
      new Error('Too many plugin host requests')
    )
    await expect(invoke).rejects.toThrow('Too many plugin host requests')
  })

  it('fails when a host result cannot be sent across the channel', async () => {
    const { rpc, receive, callHost, onFailure } = setup()
    vi.mocked(callHost).mockResolvedValue((() => {}) as never)
    const init = rpc.request('init', {})
    receive({ type: 'result', id: 1 })
    await init
    receive({ type: 'host', id: 9, method: 'log', args: [] })
    await vi.waitFor(() => expect(onFailure).toHaveBeenCalled())
    rpc.close()
  })

  it('times out a host call that never settles', async () => {
    vi.useFakeTimers()
    try {
      const { rpc, receive, send, callHost } = setup()
      vi.mocked(callHost).mockImplementation(() => new Promise(() => {}))
      const init = rpc.request('init', {})
      receive({ type: 'result', id: 1 })
      await init
      receive({ type: 'host', id: 5, method: 'log', args: [] })
      await vi.advanceTimersByTimeAsync(10000)
      expect(send).toHaveBeenCalledWith({
        type: 'host-result',
        id: 5,
        error: { message: 'Plugin host request timed out' },
      })
      rpc.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses requests over the limit or with uncloneable arguments', async () => {
    const { rpc } = setup()
    for (let index = 0; index < 64; index++)
      void rpc.request('invoke', {}).catch(() => {})
    await expect(rpc.request('invoke', {})).rejects.toThrow(
      'Too many plugin requests'
    )
    rpc.close()
    const fresh = setup()
    await expect(
      fresh.rpc.request('invoke', { run: () => {} })
    ).rejects.toThrow()
    fresh.rpc.close()
  })

  it('fails the peer when the transport cannot send', async () => {
    const { rpc, send, onFailure } = setup()
    send.mockImplementationOnce(() => {
      throw new Error('Port closed')
    })
    await expect(rpc.request('invoke', {})).rejects.toThrow('Port closed')
    expect(onFailure).toHaveBeenCalledWith(new Error('Port closed'))
  })

  it('aborts pending requests and stops admitting background host calls', async () => {
    const { rpc, receive, send, callHost } = setup()
    const init = rpc.request('init', {})
    receive({ type: 'result', id: 1 })
    await init
    const running = rpc.request('invoke', {})
    rpc.abortPending()
    await expect(running).rejects.toThrow('Plugin lifetime ended')
    expect(send).toHaveBeenCalledWith({ type: 'cancel', id: 2 })
    expect(send).toHaveBeenLastCalledWith({ type: 'abort' })
    receive({ type: 'host', id: 6, method: 'log', args: [] })
    expect(callHost).not.toHaveBeenCalled()
    rpc.updateMessages({ hello: 'world' })
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'messages' })
    )
    rpc.close()
  })

  it('sends message updates and fails on uncloneable ones', () => {
    const { rpc, send, onFailure } = setup()
    rpc.updateMessages({ hello: 'world' })
    expect(send).toHaveBeenCalledWith({
      type: 'messages',
      messages: { hello: 'world' },
    })
    rpc.updateMessages({ broken: () => {} })
    expect(onFailure).toHaveBeenCalledOnce()
  })
})
