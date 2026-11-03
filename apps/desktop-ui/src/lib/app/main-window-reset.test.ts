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

it('keeps a hidden active dictation mounted', async () => {
  const closeAllModals = vi.fn()
  const goToEditor = vi.fn()
  await createMainWindowReset({
    closeAllModals,
    goToEditor,
    hasActiveInput: () => true,
  }).reset()
  expect(closeAllModals).not.toHaveBeenCalled()
  expect(goToEditor).not.toHaveBeenCalled()
})
