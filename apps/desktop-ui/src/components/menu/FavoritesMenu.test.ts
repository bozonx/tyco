import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import FavoritesMenu from './FavoritesMenu.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('FavoritesMenu', () => {
  let desktop: TestDesktop

  beforeEach(() => {
    desktop = installFakeDesktop({}, 'quick')
    desktop.backend.handle('hide_window', () => undefined)
    desktop.backend.handle('paste_into_target_and_hide', () => undefined)
    desktop.setUserConfig({
      favorites: {
        items: [
          { id: 'favorite-1', text: 'First favorite text' },
          { id: 'favorite-2', text: 'Second favorite content' },
          { id: 'favorite-3', text: 'Another code fragment' },
        ],
      },
    })
  })

  afterEach(() => {
    desktop.dispose()
  })

  const mountMenu = (props: Record<string, unknown> = {}) =>
    mount(FavoritesMenu, {
      props: { ...props },
      global: {
        plugins: [desktop.pinia],
        stubs: {
          AppIcon: true,
          KeyboardKey: { template: '<kbd class="kbd"><slot /></kbd>' },
        },
      },
    })

  it('renders all favorites initially in grid and highlights the first one', () => {
    const wrapper = mountMenu()
    const items = wrapper.findAll('.favorite-item')
    expect(items).toHaveLength(3)
    expect(items[0]?.classes()).toContain('is-selected')
    expect(items[0]?.text()).toContain('First favorite text')
    expect(items[1]?.text()).toContain('Second favorite content')
    // First 15 favorites display their slot key
    expect(items[0]?.find('.favorite-slot-key').text()).toBe('Q')
    expect(items[1]?.find('.favorite-slot-key').text()).toBe('W')
    expect(items[2]?.find('.favorite-slot-key').text()).toBe('E')
  })

  it('filters favorites by query in search input', async () => {
    const wrapper = mountMenu()
    const input = wrapper.find('.favorites-search-input')
    await input.setValue('code')

    const items = wrapper.findAll('.favorite-item')
    expect(items).toHaveLength(1)
    expect(items[0]?.text()).toContain('Another code fragment')
  })

  it('navigates from search into grid on ArrowDown and navigates with arrow keys', async () => {
    const wrapper = mountMenu()
    const input = wrapper.find('.favorites-search-input')

    // ArrowDown in search input moves focus to grid and selects index 0
    await input.trigger('keydown', { key: 'ArrowDown' })
    const grid = wrapper.find('.favorites-grid')

    let items = wrapper.findAll('.favorite-item')
    expect(items[0]?.classes()).toContain('is-selected')

    // ArrowRight in grid moves to next item
    await grid.trigger('keydown', { key: 'ArrowRight' })
    items = wrapper.findAll('.favorite-item')
    expect(items[1]?.classes()).toContain('is-selected')

    // ArrowLeft moves back
    await grid.trigger('keydown', { key: 'ArrowLeft' })
    items = wrapper.findAll('.favorite-item')
    expect(items[0]?.classes()).toContain('is-selected')
  })

  it('inserts selected favorite on Enter', async () => {
    let insertedText = ''
    desktop.backend.handle('paste_into_target_and_hide', (args) => {
      insertedText = (args as { text: string }).text
      return undefined
    })

    const wrapper = mountMenu()
    const input = wrapper.find('.favorites-search-input')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(insertedText).toBe('First favorite text')
  })

  it('inserts favorite on letter key press in grid', async () => {
    let insertedText = ''
    desktop.backend.handle('paste_into_target_and_hide', (args) => {
      insertedText = (args as { text: string }).text
      return undefined
    })

    const wrapper = mountMenu()
    const input = wrapper.find('.favorites-search-input')
    // Move from search to grid
    await input.trigger('keydown', { key: 'ArrowDown' })
    const grid = wrapper.find('.favorites-grid')

    // Press 'w' (which corresponds to favorite index 1)
    await grid.trigger('keydown', { code: 'KeyW', key: 'w' })
    await flushPromises()

    expect(insertedText).toBe('Second favorite content')
  })

  it('inserts favorite on click', async () => {
    let insertedText = ''
    desktop.backend.handle('paste_into_target_and_hide', (args) => {
      insertedText = (args as { text: string }).text
      return undefined
    })

    const wrapper = mountMenu()
    const items = wrapper.findAll('.favorite-item')
    await items[1]?.trigger('click')
    await flushPromises()

    expect(insertedText).toBe('Second favorite content')
  })

  it('displays empty message when nothing matches', async () => {
    const wrapper = mountMenu()
    const input = wrapper.find('.favorites-search-input')
    await input.setValue('nonexistent text')

    expect(wrapper.findAll('.favorite-item')).toHaveLength(0)
    expect(wrapper.find('.favorites-empty').text()).toBe('favorites.noMatches')
  })
})
