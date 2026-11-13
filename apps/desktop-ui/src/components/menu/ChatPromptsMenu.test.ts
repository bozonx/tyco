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

  beforeEach(() => {
    desktop = installFakeDesktop({}, 'quick')
    desktop.backend.handle('hide_window', () => undefined)
    desktop.backend.handle('open_main_chat', () => undefined)
    desktop.backend.handle('list_ai_profiles', () => [])
    desktop.setUserConfig({
      chatPrompts: {
        items: [
          {
            id: 'item-1',
            name: 'Summarize',
            rule: 'Summarize this in 3 bullet points',
            profileId: '',
          },
          {
            id: 'item-2',
            name: 'Critique',
            rule: 'Critique this code',
            profileId: 'gone',
          },
          { id: 'item-3', name: 'Empty', rule: '  ', profileId: '' },
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
        },
      },
      attachTo: document.body,
    })

  const names = (wrapper: ReturnType<typeof mountMenu>) =>
    wrapper.findAll('.chat-prompt-name').map((cell) => cell.text())

  it('lists the prompts with a text and the context', async () => {
    const wrapper = mountMenu()
    await flushPromises()
    expect(wrapper.find('.text-preview').text()).toBe('Some sample text')
    expect(names(wrapper)).toEqual(['Summarize', 'Critique'])
    expect(wrapper.text()).toContain('chatPrompts.missingProfile')
    wrapper.unmount()
  })

  it('runs a prompt as a quick request, without a profile that is gone', async () => {
    const wrapper = mountMenu()
    await flushPromises()
    const menuModalsStore = useMenuModalsStore()

    await wrapper.find('.search-grid-search-input').setValue('crit')
    expect(names(wrapper)).toEqual(['Critique'])
    await wrapper
      .find('.search-grid-search-input')
      .trigger('keydown', { key: 'Enter' })

    expect(menuModalsStore.currentStep?.modal).toBe(MenuModals.QUICK_AI_REQUEST)
    expect(menuModalsStore.currentStep?.params).toEqual(
      expect.objectContaining({
        text: 'Some sample text',
        profileId: null,
        prompt: 'Critique this code',
      })
    )
    wrapper.unmount()
  })

  it('runs a prompt with its profile and without the removed context', async () => {
    desktop.backend.handle('list_ai_profiles', () => [
      { id: 'gone', name: 'Reviewer' } as never,
    ])
    const wrapper = mountMenu()
    await flushPromises()
    const menuModalsStore = useMenuModalsStore()

    await wrapper
      .find('button[aria-label="action.removeContext"]')
      .trigger('click')
    await wrapper
      .find('.search-grid-search-input')
      .trigger('keydown', { key: 'ArrowDown' })
    await wrapper
      .find('.search-grid-grid')
      .trigger('keydown', { key: 'w', code: 'KeyW' })

    expect(menuModalsStore.currentStep?.params).toEqual(
      expect.objectContaining({
        text: '',
        profileId: 'gone',
        prompt: 'Critique this code',
      })
    )
    wrapper.unmount()
  })

  it('points to the settings when there are no prompts', async () => {
    desktop.setUserConfig({
      chatPrompts: { items: [] },
    })
    const wrapper = mountMenu()
    await flushPromises()
    expect(wrapper.find('.search-grid-empty').text()).toBe('chatPrompts.empty')
    expect(wrapper.text()).toContain('chatPrompts.emptyHint')
    wrapper.unmount()
  })
})
