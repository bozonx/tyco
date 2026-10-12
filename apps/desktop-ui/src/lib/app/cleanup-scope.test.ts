import { describe, expect, it, vi } from 'vitest'
import { DESKTOP_EVENTS, type DesktopListen } from '@tyco/shared'

import { createCleanupScope } from './cleanup-scope'

describe('cleanup scope', () => {
  it('removes a late subscription and ignores its events after stopping', async () => {
    let release!: (cleanup: () => void) => void
    let emit!: () => void
    const handler = vi.fn()
    const remove = vi.fn()
    const subscribe: DesktopListen = (_event, callback) => {
      emit = () => {
        void callback(null as never)
      }
      return new Promise((resolve) => {
        release = resolve
      })
    }
    const scope = createCleanupScope()
    const work = scope.listen(
      subscribe,
      DESKTOP_EVENTS.PLUGINS_CHANGED,
      handler
    )
    scope.stop()
    emit()
    release(remove)
    await work
    scope.stop()
    expect(remove).toHaveBeenCalledOnce()
    expect(handler).not.toHaveBeenCalled()
  })
})
