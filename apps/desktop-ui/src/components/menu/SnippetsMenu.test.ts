import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import SnippetsMenu from './SnippetsMenu.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('SnippetsMenu', () => {
  let desktop: TestDesktop

  beforeEach(() => {
    desktop = installFakeDesktop({}, 'quick')
    desktop.backend.handle('hide_window', () => undefined)
    desktop.backend.handle('paste_into_target_and_hide', () => undefined)
    desktop.setUserConfig({
      snippets: {
        items: [
          { id: 'snippet-1', text: 'First snippet text' },
          { id: 'snippet-2', text: 'Second snippet content' },
          { id: 'snippet-3', text: 'Another code fragment' },
        ],
      },
    })
  })

  afterEach(() => {
    desktop.dispose()
  })

  const mountMenu = (props: Record<string, unknown> = {}) =>
    mount(SnippetsMenu, {
      props: { ...props },
      global: {
        plugins: [desktop.pinia],
        stubs: {
          ActionOverlayLayout: {
            template: '<div class="layout"><slot name="actions" /></div>',
          },
          ShortcutHint: true,
          AppIcon: true,
        },
      },
    })

  it('renders all snippets initially and highlights the first one', () => {
    const wrapper = mountMenu()
    const items = wrapper.findAll('.snippet-item')
    expect(items).toHaveLength(3)
    expect(items[0]?.classes()).toContain('is-selected')
    expect(items[0]?.text()).toContain('First snippet text')
    expect(items[1]?.text()).toContain('Second snippet content')
  })

  it('filters snippets by query in search input', async () => {
    const wrapper = mountMenu()
    const input = wrapper.find('.snippets-search-input')
    await input.setValue('code')

    const items = wrapper.findAll('.snippet-item')
    expect(items).toHaveLength(1)
    expect(items[0]?.text()).toContain('Another code fragment')
  })

  it('navigates with arrow keys and updates selection', async () => {
    const wrapper = mountMenu()
    const input = wrapper.find('.snippets-search-input')

    await input.trigger('keydown', { key: 'ArrowDown' })
    let items = wrapper.findAll('.snippet-item')
    expect(items[1]?.classes()).toContain('is-selected')

    await input.trigger('keydown', { key: 'ArrowDown' })
    items = wrapper.findAll('.snippet-item')
    expect(items[2]?.classes()).toContain('is-selected')

    await input.trigger('keydown', { key: 'ArrowUp' })
    items = wrapper.findAll('.snippet-item')
    expect(items[1]?.classes()).toContain('is-selected')
  })

  it('inserts selected snippet on Enter', async () => {
    let insertedText = ''
    desktop.backend.handle('paste_into_target_and_hide', (args) => {
      insertedText = (args as { text: string }).text
      return undefined
    })

    const wrapper = mountMenu()
    const input = wrapper.find('.snippets-search-input')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(insertedText).toBe('First snippet text')
  })

  it('inserts snippet on click', async () => {
    let insertedText = ''
    desktop.backend.handle('paste_into_target_and_hide', (args) => {
      insertedText = (args as { text: string }).text
      return undefined
    })

    const wrapper = mountMenu()
    const items = wrapper.findAll('.snippet-item')
    await items[1]?.trigger('click')
    await flushPromises()

    expect(insertedText).toBe('Second snippet content')
  })

  it('displays empty message when nothing matches', async () => {
    const wrapper = mountMenu()
    const input = wrapper.find('.snippets-search-input')
    await input.setValue('nonexistent text')

    expect(wrapper.findAll('.snippet-item')).toHaveLength(0)
    expect(wrapper.find('.snippets-empty').text()).toBe('snippets.noMatches')
  })
})
