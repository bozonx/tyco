import { describe, expect, it, vi } from 'vitest'
import { DESKTOP_EVENTS, type AppEventPayloads } from '@tyco/shared'

import { createDesktopClient, type DesktopClientDeps } from './desktop-client'

function setup(available = false) {
  const handlers = new Map<string, (payload: unknown) => void | Promise<void>>()
  const remove = vi.fn()
  const invoke = vi.fn<DesktopClientDeps['invoke']>()
  const listen: DesktopClientDeps['listen'] = async (event, handler) => {
    handlers.set(event, handler as (payload: unknown) => void | Promise<void>)
    return remove
  }
  const client = createDesktopClient({
    isAvailable: () => available,
    invoke: invoke as DesktopClientDeps['invoke'],
    listen,
  })
  return { client, invoke, handlers, remove }
}

describe('desktop client', () => {
  it('isolates local parameters and event listeners between instances', async () => {
    const first = setup().client
    const second = setup().client
    const firstHandler = vi.fn()
    const secondHandler = vi.fn()
    const remove = await first.listen(
      DESKTOP_EVENTS.PARAMS_CHANGED,
      firstHandler
    )
    await second.listen(DESKTOP_EVENTS.PARAMS_CHANGED, secondHandler)
    const initial = second.getInitParams().isWindowShown
    first.setLocalParams({ isWindowShown: !initial })
    expect(first.getInitParams().isWindowShown).toBe(!initial)
    expect(second.getInitParams().isWindowShown).toBe(initial)
    expect(firstHandler).toHaveBeenCalledOnce()
    expect(secondHandler).not.toHaveBeenCalled()
    remove()
    first.setLocalParams({ isWindowShown: initial })
    expect(firstHandler).toHaveBeenCalledOnce()
  })

  it('returns detached copies of initial parameters', () => {
    const { client } = setup()
    const params = client.getInitParams()
    params.userConfig.userLanguage = 'tr_TR'
    expect(client.getInitParams().userConfig.userLanguage).not.toBe('tr_TR')
  })

  it('does not invoke the native runtime when unavailable', async () => {
    const { client, invoke } = setup()
    expect(await client.invoke('example')).toEqual({
      success: false,
      error: 'Desktop runtime is not available for command: example',
    })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('forwards native arguments and wraps successful responses', async () => {
    const { client, invoke } = setup(true)
    invoke.mockResolvedValue({ value: 1 })
    expect(await client.invoke('example', { id: 4 })).toEqual({
      success: true,
      result: { value: 1 },
    })
    expect(invoke).toHaveBeenCalledWith('example', { id: 4 })
  })

  it.each([new Error('failed'), 'failed'])(
    'normalizes native errors: %s',
    async (error) => {
      const { client, invoke } = setup(true)
      invoke.mockRejectedValue(error)
      expect(await client.invoke('example')).toEqual({
        success: false,
        error: 'failed',
      })
    }
  )

  it('validates native chat events before delivering them', async () => {
    const { client, handlers, remove } = setup(true)
    const handler = vi.fn()
    const unlisten = await client.listen(DESKTOP_EVENTS.OPEN_MAIN_CHAT, handler)
    const deliver = handlers.get(DESKTOP_EVENTS.OPEN_MAIN_CHAT)!
    expect(() => deliver({ autoSend: 'invalid' })).toThrow()
    expect(handler).not.toHaveBeenCalled()
    const payload: AppEventPayloads[typeof DESKTOP_EVENTS.OPEN_MAIN_CHAT] = {
      autoSend: true,
    }
    await deliver(payload)
    expect(handler).toHaveBeenCalledWith(payload)
    unlisten()
    expect(remove).toHaveBeenCalledOnce()
  })
})
