import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useEditorInputStore } from '../../stores/editorInput'
import { useMenuModalsStore } from '../../stores/menuModals'
import ShortcutList from '../ShortcutList.vue'
import InsertMenu from './InsertMenu.vue'

const mocks = vi.hoisted(() => ({ editorPage: true }))

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'main' }),
}))

vi.mock('../../lib/navigation/navigation', () => ({
  appNavigation: { isCurrent: () => mocks.editorPage, goToEditor: vi.fn() },
}))

const mountMenu = (props: Record<string, unknown>) =>
  mount(InsertMenu, {
    props,
    global: {
      stubs: {
        Icon: true,
        ShortcutList: true,
        Diff: true,
        TextPreview: true,
        ActionOverlayLayout: {
          props: ['title'],
          template:
            '<div data-testid="layout" :data-title="title"><slot name="preview" /><slot name="actions" /></div>',
        },
      },
    },
  })

const correctionStep = {
  correction: true,
  text: 'Corrected text',
  oldText: 'Original text',
  originalText: 'Original text',
  toEditorVisible: true,
}

describe('InsertMenu correction step', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    mocks.editorPage = true
  })

  it('over the editor, only puts the correction back in place', async () => {
    const editor = useEditorInputStore()
    editor.setValue('Before Original text after', 'plain')
    editor.setSelection('Original text', 7, 20)
    const closeAll = vi.spyOn(useMenuModalsStore(), 'closeAll')
    const wrapper = mountMenu(correctionStep)
    const list = wrapper.findComponent(ShortcutList)

    expect(list.props('leftLetterKeys')).toEqual([])
    expect(list.props('altText')).toBeUndefined()
    expect(list.props('toEditorVisible')).toBe(false)
    const space = list.props('spaceKey')
    expect(space?.id).toBe('applyToEditor')

    await space?.action('Corrected text')
    expect(editor.value).toBe('Before Corrected text after')
    expect(closeAll).toHaveBeenCalled()
  })

  it('elsewhere, keeps inserting into the window and the original text', () => {
    mocks.editorPage = false
    const list = mountMenu(correctionStep).findComponent(ShortcutList)

    expect(list.props('spaceKey')?.id).not.toBe('applyToEditor')
    expect(list.props('altText')).toBe('Original text')
    expect(list.props('toEditorVisible')).toBe(true)
  })

  it('uses menu.actions title by default and menu.correction when correcting', () => {
    const defaultWrapper = mountMenu({ text: 'Some text' })
    expect(
      defaultWrapper.find('[data-testid="layout"]').attributes('data-title')
    ).toBe('menu.actions')

    const correctionWrapper = mountMenu(correctionStep)
    expect(
      correctionWrapper.find('[data-testid="layout"]').attributes('data-title')
    ).toBe('menu.correction')
  })
})
