import { reactive } from 'vue'
import { describe, expect, it } from 'vitest'
import { createSelectionActionContext } from './selection-action-context'

function setup() {
  const state = reactive({
    desktop: 'desktop' as string | null,
    selected: 'selection',
    text: 'editor',
    shown: true,
    modal: false,
  })
  const context = createSelectionActionContext({
    desktopSelectedText: () => state.desktop,
    editorSelectedText: () => state.selected,
    editorText: () => state.text,
    isWindowShown: () => state.shown,
    hasOpenModal: () => state.modal,
  })
  return { state, ...context }
}

describe('selection action context', () => {
  it('does not process an old editor draft when a quick activation has no selection', () => {
    const context = createSelectionActionContext({
      desktopSelectedText: () => null,
      editorSelectedText: () => 'Old selection',
      editorText: () => 'Old draft',
      isWindowShown: () => true,
      hasOpenModal: () => false,
      canUseEditorText: () => false,
    })
    expect(context.text.value).toBe('')
  })
  it('reactively selects text in desktop, editor selection, editor order', () => {
    const { state, text } = setup()
    expect(text.value).toBe('desktop')
    state.desktop = null
    expect(text.value).toBe('selection')
    state.selected = ''
    expect(text.value).toBe('editor')
    state.text = ''
    expect(text.value).toBe('')
    state.desktop = ' '
    expect(text.value).toBe(' ')
  })

  it('blocks shortcuts while hidden or covered by a modal', () => {
    const { state, shortcutsDisabled } = setup()
    expect(shortcutsDisabled.value).toBe(false)
    state.shown = false
    expect(shortcutsDisabled.value).toBe(true)
    state.shown = true
    state.modal = true
    expect(shortcutsDisabled.value).toBe(true)
    state.modal = false
    expect(shortcutsDisabled.value).toBe(false)
  })
})
