import type { IpcResult, TextInsertionStatus } from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'

import {
  createTextInsertionStatusModel,
  describeKeys,
  describeTarget,
} from './text-insertion-status'

const ok = (result: TextInsertionStatus): IpcResult<TextInsertionStatus> => ({
  success: true,
  result,
})

const ready: TextInsertionStatus = {
  keySender: 'ydotool',
  keys: 'ready',
  target: 'tracked',
}

describe('describeKeys', () => {
  it('names the sender that presses the keys', () => {
    expect(describeKeys(ready)).toEqual({
      tone: 'ok',
      messageKey: 'settings.textInsertion.keysReadyYdotool',
    })
    expect(describeKeys({ ...ready, keySender: 'portal' }).messageKey).toBe(
      'settings.textInsertion.keysReadyPortal'
    )
  })

  it('asks for permission before the portal can press keys', () => {
    expect(
      describeKeys({ ...ready, keySender: 'portal', keys: 'needsPermission' })
    ).toEqual({
      tone: 'warning',
      messageKey: 'settings.textInsertion.portalNeedsPermission',
    })
  })

  it('tells how to fix a missing sender', () => {
    expect(
      describeKeys({
        keys: 'unavailable',
        problem: 'ydotooldNotRunning',
        target: 'tracked',
      })
    ).toEqual({
      tone: 'error',
      messageKey: 'settings.textInsertion.ydotooldNotRunning',
    })
    expect(
      describeKeys({ keys: 'unavailable', target: 'tracked' }).messageKey
    ).toBe('settings.textInsertion.keysUnavailable')
  })
})

describe('describeTarget', () => {
  it('warns when the target is the window that gets the focus back', () => {
    expect(describeTarget(ready).tone).toBe('ok')
    expect(describeTarget({ ...ready, target: 'focusReturn' })).toEqual({
      tone: 'warning',
      messageKey: 'settings.textInsertion.targetFocusReturn',
    })
  })
})

describe('createTextInsertionStatusModel', () => {
  it('loads the status and keeps it when a later check fails', async () => {
    const getStatus = vi
      .fn<() => Promise<IpcResult<TextInsertionStatus>>>()
      .mockResolvedValueOnce(ok(ready))
      .mockResolvedValueOnce({ success: false, error: 'Bus is gone' })
    const model = createTextInsertionStatusModel({
      getStatus,
      requestPermission: vi.fn(),
    })

    await model.refresh()
    expect(model.status.value).toEqual(ready)

    await model.refresh()
    expect(model.status.value).toEqual(ready)
    expect(model.error.value).toBe('Bus is gone')
  })

  it('shows the status the permission request ends with', async () => {
    const granted = { ...ready, keySender: 'portal' as const }
    let resolve: (result: IpcResult<TextInsertionStatus>) => void = () => {}
    const model = createTextInsertionStatusModel({
      getStatus: vi.fn(),
      requestPermission: () =>
        new Promise((done) => {
          resolve = done
        }),
    })

    const request = model.requestPermission()
    expect(model.isRequesting.value).toBe(true)
    resolve(ok(granted))
    await request

    expect(model.isRequesting.value).toBe(false)
    expect(model.status.value).toEqual(granted)
  })
})
