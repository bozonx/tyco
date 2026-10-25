import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { createTestSettingsContext } from '../../test/settings-context'
import SettingsChatTab from './SettingsChatTab.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('SettingsChatTab.vue', () => {
  it('holds the prompt and the chat history of Ask AI', async () => {
    const context = createTestSettingsContext()
    const wrapper = mount(SettingsChatTab, {
      global: {
        provide: context.provide,
        stubs: {
          SettingsChatHistorySection: {
            props: ['scope'],
            template: '<div class="chat-history-stub" :data-scope="scope" />',
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
    ).toEqual(['settings.chatPrompt'])
    expect(wrapper.get('.chat-history-stub').attributes('data-scope')).toBe(
      'askAi'
    )

    await wrapper.get('textarea').setValue('Answer briefly')
    expect(context.draft.value.llm.tasks.chat.rule).toBe('Answer briefly')
  })
})
