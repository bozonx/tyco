import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import ChatPromptsMenu from './ChatPromptsMenu.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('ChatPromptsMenu', () => {
  let desktop: TestDesktop
  let shortcutListProps: Record<string, any> = {}

  beforeEach(() => {
    desktop = installFakeDesktop({}, 'quick')
    desktop.backend.handle('hide_window', () => undefined)
    desktop.backend.handle('open_main_chat', () => undefined)
    desktop.setUserConfig({
      chatPrompts: {
        isSentImmediately: false,
        pages: [
          {
            profileId: '',
            items: [
              {
                id: 'item-1',
                name: 'Summarize',
                rule: 'Summarize this in 3 bullet points',
              },
              { id: 'item-2', name: 'Critique', rule: 'Critique this code' },
            ],
            slots: { q: 'item-1', w: 'item-2' },
          },
          {
            profileId: 'gone',
            items: [{ id: 'item-3', name: 'Lost', rule: 'Lost prompt' }],
            slots: { q: 'item-3' },
          },
        ],
      },
    })
  })

  afterEach(() => {
    desktop.dispose()
  })

  const mountMenu = (props: Record<string, unknown> = {}) =>
    mount(ChatPromptsMenu, {
      props: { text: 'Some sample text', ...props },
      global: {
        plugins: [desktop.pinia],
        stubs: {
          TextPreview: {
            props: ['text'],
            template: '<div class="text-preview">{{ text }}</div>',
          },
          ActionOverlayLayout: {
            template:
              '<div class="layout"><slot name="preview" /><slot name="actions" /></div>',
          },
          ShortcutList: {
            props: [
              'text',
              'spaceKey',
              'leftLetterKeys',
              'isEditorButtonVisible',
            ],
            setup(props: any) {
              shortcutListProps = props
              return () => null
            },
          },
        },
      },
    })

  it('renders TextPreview with provided text', () => {
    const wrapper = mountMenu()
    expect(wrapper.find('.text-preview').text()).toBe('Some sample text')
  })

  it('runs a prompt as a quick request with the profile of its page', async () => {
    const wrapper = mountMenu()
    const menuModalsStore = useMenuModalsStore()

    const qKey = shortcutListProps.leftLetterKeys[0]
    expect(qKey.name).toBe('Summarize')
    await qKey.action()
    await flushPromises()

    expect(menuModalsStore.currentStep?.modal).toBe(MenuModals.QUICK_AI_REQUEST)
    expect(menuModalsStore.currentStep?.params).toEqual(
      expect.objectContaining({
        text: 'Some sample text',
        profileId: null,
        prompt: 'Summarize this in 3 bullet points',
        isPromptSent: false,
      })
    )
    wrapper.unmount()
  })

  it('opens the page of the hotkey and reports a missing one', async () => {
    const wrapper = mountMenu({ pageIndex: 4 })
    await flushPromises()
    expect(wrapper.text()).toContain('chatPrompts.pageNotFound')
  })

  it('warns about a page whose profile is gone', async () => {
    desktop.backend.handle('list_ai_profiles', () => [])
    const wrapper = mountMenu({ pageIndex: 1 })
    await flushPromises()
    expect(wrapper.text()).toContain('chatPrompts.profileMissing')
    expect(shortcutListProps.leftLetterKeys).toEqual([])
  })
})
