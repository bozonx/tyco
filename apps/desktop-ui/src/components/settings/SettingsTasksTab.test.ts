import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { createTestSettingsContext } from '../../test/settings-context'
import SettingsTasksTab from './SettingsTasksTab.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('SettingsTasksTab.vue', () => {
  it('adds and updates task slots', async () => {
    const context = createTestSettingsContext({
      aiTasks: {
        items: [{ id: 'task-1', name: 'Existing', rule: 'Do this' }],
        slots: { q: 'task-1' },
      },
    })
    const wrapper = mount(SettingsTasksTab, {
      global: {
        provide: context.provide,
        stubs: {
          SettingsSection: { template: '<section><slot /></section>' },
          ShortcutSlots: {
            name: 'ShortcutSlots',
            props: ['items'],
            emits: ['move', 'add', 'remove'],
            template: '<div class="slots-stub" />',
          },
          FieldInput: true,
          FieldTextArea: true,
        },
      },
    })

    const slots = wrapper.findComponent({ name: 'ShortcutSlots' })
    expect(slots.props('items')[0]).toEqual({
      id: 'task-1',
      name: 'Existing',
      rule: 'Do this',
    })

    await slots.vm.$emit('add', 1)

    expect(context.draft.value.aiTasks.slots.w).toBe('task-2')
    expect(context.draft.value.aiTasks.items[1]).toEqual({
      id: 'task-2',
      name: '',
      rule: '',
    })
  })

  it('prunes empty tasks when unmounted', async () => {
    const context = createTestSettingsContext({
      aiTasks: {
        items: [
          { id: 'keep', name: 'Keep', rule: 'Rule' },
          { id: 'empty', name: '', rule: '   ' },
        ],
        slots: { q: 'keep', w: 'empty' },
      },
    })
    const wrapper = mount(SettingsTasksTab, {
      global: {
        provide: context.provide,
        stubs: {
          SettingsSection: { template: '<section><slot /></section>' },
          ShortcutSlots: {
            name: 'ShortcutSlots',
            props: ['items'],
            template: '<div />',
          },
          FieldInput: true,
          FieldTextArea: true,
        },
      },
    })

    wrapper.unmount()

    expect(context.draft.value.aiTasks).toEqual({
      items: [{ id: 'keep', name: 'Keep', rule: 'Rule' }],
      slots: { q: 'keep' },
    })
  })
})
