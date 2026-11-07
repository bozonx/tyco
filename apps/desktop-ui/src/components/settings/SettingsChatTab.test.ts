import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { createTestSettingsContext } from '../../test/settings-context'
import SettingsChatTab from './SettingsChatTab.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('SettingsChatTab.vue', () => {
  it('holds the prompt of Ask AI and leads to its chat history', async () => {
    const context = createTestSettingsContext()
    const wrapper = mount(SettingsChatTab, {
      global: {
        provide: context.provide,
        stubs: {
          FieldRow: {
            props: ['label'],
            template: '<div class="row" :data-label="label"><slot /></div>',
          },
          FieldSelect: true,
        },
      },
    })

    expect(
      wrapper.findAll('.row').map((row) => row.attributes('data-label'))
    ).toEqual(['settings.chatPrompt'])
    expect(wrapper.text()).toContain('settings.chatStorageLink')
    const section = wrapper.findComponent({ name: 'SettingsSection' })
    expect(section.props('title')).toBe('settings.chat')
    expect(section.props('info')).toBe('settings.chatInfo')

    await wrapper.get('textarea').setValue('Answer briefly')
    expect(context.draft.value.llm.tasks.chat.rule).toBe('Answer briefly')

    await wrapper.get('.inline-action').trigger('click')
    expect(context.navigate).toHaveBeenCalledWith('history')
  })
})
