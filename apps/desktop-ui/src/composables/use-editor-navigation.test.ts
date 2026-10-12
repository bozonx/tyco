import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appNavigation } from '../lib/navigation/navigation'
import { useEditorInputStore } from '../stores/editor-input'
import { useHistoryStore } from '../stores/history'
import { useIpcStore } from '../stores/ipc'
import { useEditorNavigation } from './use-editor-navigation'

const windowState = vi.hoisted(() => ({ label: 'main' }))
vi.mock('../lib/desktop/window', () => ({
  getDesktopWindow: () => windowState,
}))

let pinia: ReturnType<typeof createPinia>
beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  windowState.label = 'main'
  vi.spyOn(appNavigation, 'goToEditor').mockResolvedValue()
  vi.spyOn(useHistoryStore(), 'saveDraft').mockResolvedValue(null)
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
      .spyOn(useIpcStore(), 'callFunctionOrNotify')
      .mockResolvedValue({ success: true, result: undefined })
    useEditorNavigation().toEditor('new', 'old')
    expect(call).toHaveBeenCalledWith('openMainEditor', ['new', 'old'])
    expect(useEditorInputStore().value).toBe('')
    expect(appNavigation.goToEditor).not.toHaveBeenCalled()
  })
})
