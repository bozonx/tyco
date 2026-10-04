import { describe, expect, it, vi } from 'vitest'

import { createMainWindowReset } from './main-window-reset'

describe('createMainWindowReset', () => {
  it('closes the menus and goes back to the editor', async () => {
    const calls: string[] = []
    const reset = createMainWindowReset({
      closeAllModals: vi.fn(() => calls.push('close')),
      goToEditor: vi.fn(async () => {
        calls.push('editor')
      }),
    })

    await reset.reset()

    expect(calls).toEqual(['close', 'editor'])
  })
})
