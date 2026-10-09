import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import SettingsTasksTab from './SettingsTasksTab.vue'

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('SettingsTasksTab.vue', () => {
  it('adds and updates task slots', async () => {
    const wrapper = mount(SettingsTasksTab, {
      props: {
        userConfig: { aiTasks: [{ name: 'Existing', rule: 'Do this' }] },
      },
      global: {
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
      name: 'Existing',
      rule: 'Do this',
    })

    await slots.vm.$emit('add', 1)

    const emitted = wrapper.emitted('update:aiTasks')
    expect(emitted).toBeTruthy()
    const firstEmitted = emitted![0]![0] as ({
      name: string
      rule: string
    } | null)[]
    expect(firstEmitted[1]).toEqual({ name: '', rule: '' })
  })

  it('prunes empty tasks when unmounted', async () => {
    const wrapper = mount(SettingsTasksTab, {
      props: {
        userConfig: {
          aiTasks: [
            { name: 'Keep', rule: 'Rule' },
            { name: '', rule: '   ' },
          ],
        },
      },
      global: {
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

    const emitted = wrapper.emitted('update:aiTasks')
    expect(emitted).toBeTruthy()
    const lastEmitted = emitted![emitted!.length - 1]![0] as ({
      name: string
      rule: string
    } | null)[]
    expect(lastEmitted[0]).toEqual({ name: 'Keep', rule: 'Rule' })
    expect(lastEmitted[1]).toBeNull()
  })
})
