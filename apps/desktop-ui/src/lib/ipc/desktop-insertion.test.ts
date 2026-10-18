import { describe, expect, it, vi } from 'vitest'

import { createDesktopInsertion } from './desktop-insertion'

describe('createDesktopInsertion', () => {
  it('ignores blank text without calling IPC', async () => {
    const pasteIntoTargetAndHide = vi.fn()
    const notifyDesktop = vi.fn()
    const insertion = createDesktopInsertion({
      pasteIntoTargetAndHide,
      notifyDesktop,
      translateInsertFailed: () => 'Insert failed',
    })

    await insertion.pasteIntoTargetAndHide('   ')
    expect(pasteIntoTargetAndHide).not.toHaveBeenCalled()
  })

  it('notifies desktop and throws when pasting fails', async () => {
    const pasteIntoTargetAndHide = vi.fn(async () => ({
      success: false as const,
      error: 'No target window',
    }))
    const notifyDesktop = vi.fn(async () => ({
      success: true as const,
      result: undefined,
    }))
    const insertion = createDesktopInsertion({
      pasteIntoTargetAndHide,
      notifyDesktop,
      translateInsertFailed: () => 'Insert failed',
    })

    await expect(insertion.pasteIntoTargetAndHide('Hello')).rejects.toThrow(
      'Insert failed: No target window'
    )
    expect(notifyDesktop).toHaveBeenCalledWith(
      'Insert failed',
      'No target window'
    )
  })
})
