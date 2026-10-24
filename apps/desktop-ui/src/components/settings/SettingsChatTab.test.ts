import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { createTestSettingsContext } from '../../test/settings-context'
import SettingsChatTab from './SettingsChatTab.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('SettingsChatTab.vue', () => {
  it('holds the chat prompt, attachments and chat history', async () => {
    const context = createTestSettingsContext()
    const wrapper = mount(SettingsChatTab, {
      global: {
        provide: context.provide,
        stubs: {
          SettingsChatHistorySection: {
            template: '<div class="chat-history-stub" />',
          },
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
    ).toEqual(['settings.chatPrompt', 'settings.chatImageQuality'])
    expect(wrapper.find('.chat-history-stub').exists()).toBe(true)

    await wrapper.get('textarea').setValue('Answer briefly')
    expect(context.draft.value.llm.tasks.chat.rule).toBe('Answer briefly')
  })
})
