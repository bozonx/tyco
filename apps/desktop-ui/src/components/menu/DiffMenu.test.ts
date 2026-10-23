import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ShortcutList from '../overlay/ShortcutList.vue'
import DiffMenu from './DiffMenu.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
let pinia: ReturnType<typeof createPinia>
beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
})
afterEach(() => disposePinia(pinia))
const mountMenu = (replaceEditor?: () => void) =>
  mount(DiffMenu, {
    props: { oldText: 'unsaved document', newText: 'result', replaceEditor },
    global: {
      plugins: [pinia],
      stubs: {
        ShortcutList: true,
        Diff: true,
        ResultViewModeToggle: true,
        ActionOverlayLayout: {
          props: ['title', 'escMode'],
          template:
            '<div :data-title="title" :data-esc-mode="escMode"><slot name="actions" /></div>',
        },
      },
    },
  })

describe('editor transfer review', () => {
  it('requires the explicit replacement action and keeps Escape available for going back', async () => {
    const replace = vi.fn()
    const wrapper = mountMenu(replace)
    expect(wrapper.attributes('data-title')).toBe('editor.conflict.title')
    expect(wrapper.attributes('data-esc-mode')).toBe('back')
    const list = wrapper.findComponent(ShortcutList)
    expect(list.props('isEditorButtonVisible')).toBe(false)
    expect(list.props('leftLetterKeys')).toEqual([])
    expect(list.props('escMode')).toBe('back')
    expect(list.props('spaceKey')).toMatchObject({
      id: 'replaceEditor',
      labelKey: 'editor.conflict.replace',
    })
    expect(replace).not.toHaveBeenCalled()
    await list.props('spaceKey')?.action('result')
    expect(replace).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('retains the normal result actions and closes window on Escape when there is no editor conflict', () => {
    const wrapper = mountMenu()
    expect(wrapper.attributes('data-title')).toBe('menu.compareResult')
    expect(wrapper.attributes('data-esc-mode')).toBe('close')
    const list = wrapper.findComponent(ShortcutList)
    expect(list.props('isEditorButtonVisible')).toBe(true)
    expect(list.props('escMode')).toBe('close')
    expect(list.props('spaceKey')?.id).not.toBe('replaceEditor')
    wrapper.unmount()
  })
})
