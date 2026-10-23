import { describe, expect, it, vi } from 'vitest'
import { DESKTOP_EVENTS } from '@tyco/shared'

const native = vi.hoisted(() => ({ label: 'main', listen: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }))
vi.mock('@tauri-apps/api/event', () => ({ listen: native.listen }))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: native.label }),
}))
vi.mock('./invoke', () => ({ invokeDesktop: vi.fn() }))

import { desktopClient } from './client'

describe('native desktop event subscriptions', () => {
  it.each(['main', 'quick'])(
    'addresses shutdown subscriptions to the %s window',
    async (label) => {
      native.label = label
      const remove = vi.fn()
      native.listen.mockResolvedValueOnce(remove)
      const request = vi.fn()
      const unsubscribe = await desktopClient.listen(
        DESKTOP_EVENTS.QUIT_REQUESTED,
        request
      )

      expect(native.listen).toHaveBeenCalledWith(
        DESKTOP_EVENTS.QUIT_REQUESTED,
        expect.any(Function),
        { target: { kind: 'AnyLabel', label } }
      )
      const deliver = native.listen.mock.lastCall![1]
      deliver({ payload: 7 })
      expect(request).toHaveBeenCalledWith(7)
      unsubscribe()
      expect(remove).toHaveBeenCalledOnce()
    }
  )
})
