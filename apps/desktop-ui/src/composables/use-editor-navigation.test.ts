import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appNavigation } from '../lib/navigation/navigation'
import { useEditorInputStore } from '../stores/editor-input'
import { useIpcStore } from '../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../stores/menu-modals'
import { useEditorNavigation } from './use-editor-navigation'

const windowState = vi.hoisted(() => ({ label: 'main' }))
vi.mock('../lib/desktop/window', () => ({
  getDesktopWindow: () => windowState,
  isQuickWindow: () => windowState.label === 'quick',
}))

let pinia: ReturnType<typeof createPinia>
beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  windowState.label = 'main'
  vi.spyOn(appNavigation, 'goToEditor').mockResolvedValue()
})
afterEach(() => {
  disposePinia(pinia)
  vi.restoreAllMocks()
})

describe('editor navigation', () => {
  it('keeps the editor as the single source of transferred text', () => {
    useEditorNavigation().toEditor('imported')
    const editor = useEditorInputStore()
    expect(editor.value).toBe('imported')
    editor.setValue('edited')
    useEditorNavigation().toEditor()
    expect(editor.value).toBe('edited')
    useEditorNavigation().toEditor('')
    expect(editor.value).toBe('')
  })

  it('preserves the document around a transformed selection', () => {
    const editor = useEditorInputStore()
    editor.setValue('before old after')
    editor.setSelection('old', 7, 10)
    useEditorNavigation().applyEditorTransfer('new', 'old')
    expect(editor.value).toBe('before new after')
  })

  it('delegates a quick window transfer to the main window', () => {
    windowState.label = 'quick'
    const call = vi
      .spyOn(useIpcStore(), 'callOrNotify')
      .mockResolvedValue({ success: true, result: undefined })
    useEditorNavigation().toEditor('new', 'old')
    expect(call).toHaveBeenCalledWith('open_main_editor', {
      text: 'new',
      sourceText: 'old',
    })
    expect(useEditorInputStore().value).toBe('')
    expect(appNavigation.goToEditor).not.toHaveBeenCalled()
  })
})

it('retains the result dialog and unsaved editor text on a transfer conflict', () => {
  const editor = useEditorInputStore()
  editor.setValue('before old after')
  editor.setSelection('old', 7, 10)
  editor.captureResultSource('old')
  editor.setSelection('', 0, 0)
  const close = vi.spyOn(useMenuModalsStore(), 'closeAll')
  useEditorNavigation().toEditor('new', 'old')
  expect(editor.value).toBe('before old after')
  expect(close).not.toHaveBeenCalled()
  expect(appNavigation.goToEditor).not.toHaveBeenCalled()
})

it('offers explicit document replacement after reviewing a transfer conflict', () => {
  const editor = useEditorInputStore()
  editor.setValue('unsaved document')
  useEditorNavigation().toEditor('foreign result', 'foreign source')
  const modals = useMenuModalsStore()
  const step = modals.currentStep
  expect(step?.modal).toBe(MenuModals.DIFF)
  if (step?.modal !== MenuModals.DIFF)
    throw new Error('Expected transfer review')
  expect(step.params.oldText).toBe('unsaved document')
  expect(step.params.newText).toBe('foreign result')
  expect(editor.value).toBe('unsaved document')
  step.params.replaceEditor?.()
  expect(editor.value).toBe('foreign result')
  expect(modals.hasOpenModal).toBe(false)
  expect(appNavigation.goToEditor).toHaveBeenCalledOnce()
})

it('refreshes the transfer review instead of overwriting edits made during review', () => {
  const editor = useEditorInputStore()
  editor.setValue('unsaved document')
  useEditorNavigation().toEditor('result', 'source')
  const modals = useMenuModalsStore()
  const step = modals.currentStep
  if (step?.modal !== MenuModals.DIFF)
    throw new Error('Expected transfer review')
  editor.setValue('newer document')
  step.params.replaceEditor?.()
  expect(editor.value).toBe('newer document')
  expect(modals.currentModalParams).toMatchObject({
    oldText: 'newer document',
    newText: 'result',
  })
  expect(appNavigation.goToEditor).not.toHaveBeenCalled()
  step.params.replaceEditor?.()
  expect(editor.value).toBe('result')
})
