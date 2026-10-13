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
