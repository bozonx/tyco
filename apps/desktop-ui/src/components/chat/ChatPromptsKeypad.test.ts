import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import ChatPromptsKeypad from './ChatPromptsKeypad.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('ChatPromptsKeypad.vue', () => {
  let desktop: TestDesktop

  beforeEach(() => {
    desktop = installFakeDesktop({}, 'chat')
    desktop.setUserConfig({
      chatPrompts: {
        items: [
          { id: 'p0', name: 'Poem', rule: 'Write a poem', profileId: 'writer' },
          {
            id: 'p1',
            name: 'Summarize',
            rule: 'Summarize the text',
            profileId: '',
          },
          {
            id: 'p2',
            name: 'Explain',
            rule: 'Explain in simple terms',
            profileId: '',
          },
        ],
      },
    })
  })

  afterEach(() => {
    desktop.dispose()
  })

  const mountKeypad = () =>
    mount(ChatPromptsKeypad, {
      props: { isOpen: true, anchor: document.createElement('div') },
      global: { plugins: [desktop.pinia], stubs: { Teleport: true } },
      attachTo: document.body,
    })

  const names = (wrapper: ReturnType<typeof mountKeypad>) =>
    wrapper.findAll('.chat-prompt-name').map((cell) => cell.text())

  it('offers the prompts of every profile, not those of another profile', () => {
    const wrapper = mountKeypad()
    expect(names(wrapper)).toEqual(['Summarize', 'Explain'])
    wrapper.unmount()
  })

  it('inserts a prompt on click', async () => {
    const wrapper = mountKeypad()
    await wrapper.findAll('.search-grid-cell')[0]!.trigger('click')

    expect(wrapper.emitted('select')).toEqual([['Summarize the text']])
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('filters by the search and picks with a shortcut key in the grid', async () => {
    const wrapper = mountKeypad()
    await wrapper.find('.search-grid-search-input').setValue('expl')
    expect(names(wrapper)).toEqual(['Explain'])

    await wrapper
      .find('.search-grid-search-input')
      .trigger('keydown', { key: 'ArrowDown' })
    await wrapper
      .find('.search-grid-grid')
      .trigger('keydown', { key: 'q', code: 'KeyQ' })

    expect(wrapper.emitted('select')).toEqual([['Explain in simple terms']])
    wrapper.unmount()
  })

  it('closes on Escape', async () => {
    const wrapper = mountKeypad()
    await wrapper
      .find('.search-grid-grid')
      .trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('shows the empty hint when the chat has no prompts', async () => {
    desktop.setUserConfig({
      chatPrompts: { items: [] },
    })
    await flushPromises()
    const wrapper = mountKeypad()
    expect(wrapper.find('.search-grid-empty').text()).toBe(
      'chat.noPromptsConfigured'
    )
    wrapper.unmount()
  })
})
