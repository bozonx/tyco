import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import SettingsLanguagesTab from './SettingsLanguagesTab.vue'

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('SettingsLanguagesTab.vue', () => {
  const mountTab = () =>
    mount(SettingsLanguagesTab, {
      props: { userConfig: { toTranslateLanguages: ['en_US', 'ru_RU'] } },
      global: {
        stubs: {
          SettingsSection: {
            template: '<section><slot name="description" /><slot /></section>',
          },
          ShortcutSlots: {
            name: 'ShortcutSlots',
            props: ['items'],
            emits: ['move', 'add', 'remove'],
            template: '<div class="slots-stub" />',
          },
          FieldSelect: true,
        },
      },
    })

  it('edits the language slots', async () => {
    const wrapper = mountTab()
    const slots = wrapper.findComponent({ name: 'ShortcutSlots' })
    expect(slots.props('items').slice(0, 2)).toEqual(['en_US', 'ru_RU'])

    await slots.vm.$emit('remove', 0)

    const [[languages]] = wrapper.emitted('update:toTranslateLanguages')!
    expect((languages as (string | null)[]).slice(0, 2)).toEqual([
      null,
      'ru_RU',
    ])
  })

  it('links to the translation settings tab', async () => {
    const wrapper = mountTab()

    await wrapper.find('.settings-inline-link').trigger('click')

    expect(wrapper.emitted('navigate')).toEqual([['translations']])
  })
})
