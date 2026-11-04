import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { createTestSettingsContext } from '../../test/settings-context'
import SettingsFavoritesTab from './SettingsFavoritesTab.vue'
import type { UserConfig } from '@tyco/shared'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}))

describe('SettingsFavoritesTab', () => {
  const mountTab = (config: Partial<UserConfig> = {}) => {
    const context = createTestSettingsContext(config)
    const wrapper = mount(SettingsFavoritesTab, {
      global: {
        provide: context.provide,
        stubs: {
          SettingsSection: {
            props: ['title', 'info'],
            template:
              '<div class="settings-section"><slot name="actions" /><slot /></div>',
          },
          FieldPromptTextArea: {
            props: ['modelValue', 'placeholder'],
            emits: ['update:modelValue'],
            template:
              '<textarea class="field-prompt-text-area" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          },
          DragHandle: true,
          IconButton: {
            props: ['icon', 'label'],
            emits: ['click'],
            template:
              '<button class="icon-btn" @click="$emit(\'click\')">{{ label }}</button>',
          },
          Button: {
            emits: ['click'],
            template:
              '<button class="btn" @click="$emit(\'click\')"><slot /></button>',
          },
          StateMessage: {
            props: ['message'],
            template: '<div class="state-message">{{ message }}</div>',
          },
        },
      },
    })
    return { wrapper, context }
  }

  it('renders empty state when there are no favorites', () => {
    const { wrapper } = mountTab({ favorites: { items: [] } })
    expect(wrapper.find('.state-message').text()).toBe('settings.noFavorites')
    expect(wrapper.findAll('.favorite-card')).toHaveLength(0)
  })

  it('renders existing favorites list', () => {
    const { wrapper } = mountTab({
      favorites: {
        items: [
          { id: 'favorite-1', text: 'Text 1' },
          { id: 'favorite-2', text: 'Text 2' },
        ],
      },
    })
    const cards = wrapper.findAll('.favorite-card')
    expect(cards).toHaveLength(2)
  })

  it('adds a new favorite to the bottom when Add button is clicked', async () => {
    const { wrapper, context } = mountTab({
      favorites: { items: [{ id: 'favorite-1', text: 'Existing' }] },
    })

    const addBtn = wrapper.find('.btn')
    await addBtn.trigger('click')
    await nextTick()

    const items = context.draft.value.favorites.items
    expect(items).toHaveLength(2)
    expect(items[0]?.id).toBe('favorite-1')
    expect(items[1]?.text).toBe('')
    expect(items[1]?.id).toBe('favorite-2')
  })

  it('highlights empty favorites with is-empty class', () => {
    const { wrapper } = mountTab({
      favorites: {
        items: [
          { id: 'favorite-1', text: 'Has text' },
          { id: 'favorite-2', text: '   ' },
        ],
      },
    })

    const cards = wrapper.findAll('.favorite-card')
    expect(cards[0]?.classes()).not.toContain('is-empty')
    expect(cards[1]?.classes()).toContain('is-empty')
  })

  it('updates favorite text on textarea input', async () => {
    const { wrapper, context } = mountTab({
      favorites: { items: [{ id: 'favorite-1', text: 'Initial' }] },
    })

    const textarea = wrapper.find('textarea')
    await textarea.setValue('Modified content')
    await nextTick()

    expect(context.draft.value.favorites.items[0]?.text).toBe('Modified content')
  })

  it('deletes a favorite when delete button is clicked', async () => {
    const { wrapper, context } = mountTab({
      favorites: {
        items: [
          { id: 'favorite-1', text: 'Keep' },
          { id: 'favorite-2', text: 'Delete me' },
        ],
      },
    })

    const deleteButtons = wrapper.findAll('.icon-btn')
    expect(deleteButtons).toHaveLength(2)
    await deleteButtons[1]?.trigger('click')
    await nextTick()

    expect(context.draft.value.favorites.items).toHaveLength(1)
    expect(context.draft.value.favorites.items[0]?.id).toBe('favorite-1')
  })
})
