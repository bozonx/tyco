import { describe, expect, it, vi } from 'vitest'
import { DESKTOP_EVENTS, type AppEventPayloads } from '@tyco/shared'

import {
  createDesktopClient,
  type DesktopClientDependencies,
} from './desktop-client'

function setup(available = false) {
  const handlers = new Map<string, (payload: unknown) => void | Promise<void>>()
  const remove = vi.fn()
  const invoke = vi.fn<DesktopClientDependencies['invoke']>()
  const listen: DesktopClientDependencies['listen'] = async (
    event,
    handler
  ) => {
    handlers.set(event, handler as (payload: unknown) => void | Promise<void>)
    return remove
  }
  const onEventError = vi.fn()
  const client = createDesktopClient({
    isAvailable: () => available,
    invoke: invoke as DesktopClientDependencies['invoke'],
    listen,
    onEventError,
  })
  return { client, invoke, handlers, remove, onEventError }
}

describe('desktop client', () => {
  it('isolates local parameters and event listeners between instances', async () => {
    const first = setup().client
    const second = setup().client
    const firstHandler = vi.fn()
    const secondHandler = vi.fn()
    const remove = await first.listen(
      DESKTOP_EVENTS.STATE_CHANGED,
      firstHandler
    )
    await second.listen(DESKTOP_EVENTS.STATE_CHANGED, secondHandler)
    const initial = second.getDesktopViewState().isWindowShown
    first.setLocalParams({ isWindowShown: !initial })
    expect(first.getDesktopViewState().isWindowShown).toBe(!initial)
    expect(second.getDesktopViewState().isWindowShown).toBe(initial)
    expect(firstHandler).toHaveBeenCalledOnce()
    expect(secondHandler).not.toHaveBeenCalled()
    remove()
    first.setLocalParams({ isWindowShown: initial })
    expect(firstHandler).toHaveBeenCalledOnce()
  })

  it('returns detached copies of initial parameters', () => {
    const { client } = setup()
    const params = client.getDesktopViewState()
    params.userConfig.userLanguage = 'tr_TR'
    expect(client.getDesktopViewState().userConfig.userLanguage).not.toBe(
      'tr_TR'
    )
  })

  it('does not invoke the native runtime when unavailable', async () => {
    const { client, invoke } = setup()
    expect(await client.invoke('get_storage_info')).toEqual({
      success: false,
      error: 'Desktop runtime is not available for command: get_storage_info',
    })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('forwards native arguments and wraps successful responses', async () => {
    const { client, invoke } = setup(true)
    invoke.mockResolvedValue(null)
    expect(await client.invoke('get_chat', { id: 'chat-4' })).toEqual({
      success: true,
      result: null,
    })
    expect(invoke).toHaveBeenCalledWith('get_chat', { id: 'chat-4' })
  })

  it.each([new Error('failed'), 'failed'])(
    'normalizes native errors: %s',
    async (error) => {
      const { client, invoke } = setup(true)
      invoke.mockRejectedValue(error)
      expect(await client.invoke('get_storage_info')).toEqual({
        success: false,
        error: 'failed',
      })
    }
  )

  it('exposes native error codes without changing the message contract', async () => {
    const { client, invoke } = setup(true)
    invoke.mockRejectedValue({ code: 'ioError', message: 'Permission denied' })
    expect(await client.invoke('get_storage_info')).toEqual({
      success: false,
      error: 'Permission denied',
      errorCode: 'ioError',
    })
  })

  it('validates native chat events before delivering them', async () => {
    const { client, handlers, remove, onEventError } = setup(true)
    const handler = vi.fn()
    const unlisten = await client.listen(DESKTOP_EVENTS.OPEN_MAIN_CHAT, handler)
    const deliver = handlers.get(DESKTOP_EVENTS.OPEN_MAIN_CHAT)!
    deliver({ autoSend: 'invalid' })
    expect(onEventError).toHaveBeenCalledOnce()
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

it('contains asynchronous event failures and continues delivering events', async () => {
  const { client, handlers, onEventError } = setup(true)
  const handler = vi
    .fn()
    .mockRejectedValueOnce(new Error('Navigation failed'))
    .mockResolvedValueOnce(undefined)
  await client.listen(DESKTOP_EVENTS.OPEN_MAIN_CHAT, handler)
  const deliver = handlers.get(DESKTOP_EVENTS.OPEN_MAIN_CHAT)!
  deliver({ autoSend: true })
  await vi.waitFor(() => expect(onEventError).toHaveBeenCalledOnce())
  deliver({ autoSend: false })
  expect(handler).toHaveBeenCalledTimes(2)
})
