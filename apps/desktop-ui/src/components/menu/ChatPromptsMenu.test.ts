import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
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

  it('binds configured prompt shortcuts and calls open_main_chat on action', async () => {
    const openMainChat = vi.fn()
    desktop.backend.handle('open_main_chat', openMainChat)
    const hideWindow = vi.fn()
    desktop.backend.handle('hide_window', hideWindow)

    mountMenu()

    const qKey = shortcutListProps.leftLetterKeys[0]
    expect(qKey).toBeDefined()
    expect(qKey.name).toBe('Summarize')

    await qKey.action()
    await flushPromises()

    expect(openMainChat).toHaveBeenCalledWith(
      expect.objectContaining({
        attachment: { text: 'Some sample text' },
        question: 'Summarize this in 3 bullet points',
        autoSend: true,
      })
    )
  })
})
