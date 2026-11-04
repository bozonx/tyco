import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { createTestSettingsContext } from '../../test/settings-context'
import SettingsSnippetsTab from './SettingsSnippetsTab.vue'
import type { UserConfig } from '@tyco/shared'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}))

describe('SettingsSnippetsTab', () => {
  const mountTab = (config: Partial<UserConfig> = {}) => {
    const context = createTestSettingsContext(config)
    const wrapper = mount(SettingsSnippetsTab, {
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

  it('renders empty state when there are no snippets', () => {
    const { wrapper } = mountTab({ snippets: { items: [] } })
    expect(wrapper.find('.state-message').text()).toBe('settings.noSnippets')
    expect(wrapper.findAll('.snippet-card')).toHaveLength(0)
  })

  it('renders existing snippets list', () => {
    const { wrapper } = mountTab({
      snippets: {
        items: [
          { id: 'snippet-1', text: 'Text 1' },
          { id: 'snippet-2', text: 'Text 2' },
        ],
      },
    })
    const cards = wrapper.findAll('.snippet-card')
    expect(cards).toHaveLength(2)
  })

  it('adds a new snippet when Add button is clicked', async () => {
    const { wrapper, context } = mountTab({
      snippets: { items: [{ id: 'snippet-1', text: 'Existing' }] },
    })

    const addBtn = wrapper.find('.btn')
    await addBtn.trigger('click')
    await nextTick()

    const items = context.draft.value.snippets.items
    expect(items).toHaveLength(2)
    expect(items[0]?.text).toBe('')
    expect(items[0]?.id).toBe('snippet-2')
  })

  it('updates snippet text on textarea input', async () => {
    const { wrapper, context } = mountTab({
      snippets: { items: [{ id: 'snippet-1', text: 'Initial' }] },
    })

    const textarea = wrapper.find('textarea')
    await textarea.setValue('Modified content')
    await nextTick()

    expect(context.draft.value.snippets.items[0]?.text).toBe('Modified content')
  })

  it('deletes a snippet when delete button is clicked', async () => {
    const { wrapper, context } = mountTab({
      snippets: {
        items: [
          { id: 'snippet-1', text: 'Keep' },
          { id: 'snippet-2', text: 'Delete me' },
        ],
      },
    })

    const deleteButtons = wrapper.findAll('.icon-btn')
    expect(deleteButtons).toHaveLength(2)
    await deleteButtons[1]?.trigger('click')
    await nextTick()

    expect(context.draft.value.snippets.items).toHaveLength(1)
    expect(context.draft.value.snippets.items[0]?.id).toBe('snippet-1')
  })
})
