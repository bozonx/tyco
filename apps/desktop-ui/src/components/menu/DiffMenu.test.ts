import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useActionMenuStore } from '../../stores/action-menu'
import { installFakeDesktop } from '../../test/install-fake-desktop'
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
    expect(wrapper.attributes('data-esc-mode')).toBe('auto')
    const list = wrapper.findComponent(ShortcutList)
    expect(list.props('isEditorButtonVisible')).toBe(false)
    expect(list.props('leftLetterKeys')).toEqual([])
    expect(list.props('escMode')).toBe('auto')
    expect(list.props('spaceKey')).toMatchObject({
      id: 'replaceEditor',
      labelKey: 'editor.conflict.replace',
    })
    expect(replace).not.toHaveBeenCalled()
    await list.props('spaceKey')?.action('result')
    expect(replace).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('retains the normal result actions and uses stack navigation on Escape when there is no editor conflict', () => {
    const wrapper = mountMenu()
    expect(wrapper.attributes('data-title')).toBe('menu.compareResult')
    expect(wrapper.attributes('data-esc-mode')).toBe('auto')
    const list = wrapper.findComponent(ShortcutList)
    expect(list.props('isEditorButtonVisible')).toBe(true)
    expect(list.props('escMode')).toBe('auto')
    expect(list.props('spaceKey')?.id).not.toBe('replaceEditor')
    wrapper.unmount()
  })
})

describe('action pages on a result', () => {
  const pressKey = (key: string, init: KeyboardEventInit = {}) =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key, ...init }))
  const firstActionId = (wrapper: ReturnType<typeof mount>) =>
    (
      wrapper.findComponent(ShortcutList).props('leftLetterKeys') as {
        id?: string
      }[]
    )[0]?.id

  it('pages through the pages that take text, while the arrows keep switching the view', async () => {
    const desktop = installFakeDesktop()
    await desktop.load()
    desktop.setUserConfig({
      actionPages: [
        {
          inputMode: 'selection',
          slots: { q: { type: 'standard', actionId: 'copyToClipboard' } },
        },
        {
          inputMode: 'none',
          slots: { q: { type: 'standard', actionId: 'askInCurrentChat' } },
        },
        {
          inputMode: 'selection',
          slots: { q: { type: 'standard', actionId: 'insertIntoWindow' } },
        },
      ],
    })
    const actionMenuStore = useActionMenuStore()
    actionMenuStore.setPage(2)
    const wrapper = mount(DiffMenu, {
      props: { oldText: 'old', newText: 'new' },
      global: {
        plugins: [desktop.pinia],
        stubs: {
          ShortcutList: true,
          Diff: true,
          ResultViewModeToggle: true,
          ActionOverlayLayout: {
            template:
              '<div><slot name="header-extra" /><slot name="actions" /></div>',
          },
        },
      },
    })

    // a result opens on the first page and hides the page without text
    expect(actionMenuStore.pageIndex).toBe(0)
    const buttons = wrapper.findAll('.action-page-button')
    expect(buttons.map((button) => button.text())).toEqual([
      expect.stringContaining('1'),
      expect.stringContaining('3'),
    ])
    expect(firstActionId(wrapper)).toBe('copyToClipboard')

    pressKey('Tab')
    await wrapper.vm.$nextTick()
    expect(actionMenuStore.pageIndex).toBe(2)
    expect(firstActionId(wrapper)).toBe('insertIntoWindow')
    expect(wrapper.findComponent(ShortcutList).props('pageIndex')).toBe(2)

    pressKey('Tab', { shiftKey: true })
    expect(actionMenuStore.pageIndex).toBe(0)
    // the digit of a page without text does nothing
    pressKey('2')
    expect(actionMenuStore.pageIndex).toBe(0)
    pressKey('3')
    expect(actionMenuStore.pageIndex).toBe(2)

    pressKey('ArrowRight')
    expect(actionMenuStore.pageIndex).toBe(2)

    await buttons[0].trigger('click')
    expect(actionMenuStore.pageIndex).toBe(0)
    wrapper.unmount()
  })

  it('offers no pages while resolving an editor conflict', async () => {
    const desktop = installFakeDesktop()
    await desktop.load()
    desktop.setUserConfig({
      actionPages: [
        { inputMode: 'selection', slots: {} },
        { inputMode: 'selection', slots: {} },
      ],
    })
    const wrapper = mount(DiffMenu, {
      props: { oldText: 'old', newText: 'new', replaceEditor: vi.fn() },
      global: {
        plugins: [desktop.pinia],
        stubs: {
          ShortcutList: true,
          Diff: true,
          ResultViewModeToggle: true,
          ActionOverlayLayout: {
            template: '<div><slot name="header-extra" /></div>',
          },
        },
      },
    })
    expect(wrapper.findAll('.action-page-button')).toHaveLength(0)
    pressKey('Tab')
    expect(useActionMenuStore().pageIndex).toBe(0)
    wrapper.unmount()
  })
})
