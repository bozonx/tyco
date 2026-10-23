import { DEFAULT_USER_CONFIG } from '@tyco/shared'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { createTestSettingsContext } from '../../test/settings-context'
import SettingsLanguagesTab from './SettingsLanguagesTab.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('SettingsLanguagesTab.vue', () => {
  let context: ReturnType<typeof createTestSettingsContext>
  const mountTab = () => {
    context = createTestSettingsContext({
      translation: {
        ...DEFAULT_USER_CONFIG.translation,
        targetLanguages: { q: 'en-US', w: 'ru-RU' },
      },
    })
    return mount(SettingsLanguagesTab, {
      global: {
        provide: context.provide,
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
  }

  it('edits the language slots', async () => {
    const wrapper = mountTab()
    const slots = wrapper.findComponent({ name: 'ShortcutSlots' })
    expect(slots.props('items').slice(0, 2)).toEqual(['en-US', 'ru-RU'])

    await slots.vm.$emit('remove', 0)

    expect(context.draft.value.translation.targetLanguages).toEqual({
      w: 'ru-RU',
    })
  })

  it('links to the translation settings tab', async () => {
    const wrapper = mountTab()

    await wrapper.find('.inline-action').trigger('click')

    expect(context.navigate).toHaveBeenCalledWith('translations')
  })
})
