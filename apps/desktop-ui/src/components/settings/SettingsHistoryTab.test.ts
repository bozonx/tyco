import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { createTestSettingsContext } from '../../test/settings-context'
import SettingsHistoryTab from './SettingsHistoryTab.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('SettingsHistoryTab.vue', () => {
  it('holds the action history and the chats of Ask AI in every mode', () => {
    const mountTab = (isInDevelopment: boolean) =>
      mount(SettingsHistoryTab, {
        global: {
          provide: createTestSettingsContext({ isInDevelopment }).provide,
          stubs: {
            SettingsEditorHistorySection: {
              template: '<div class="editor-history-stub" />',
            },
            SettingsChatHistorySection: {
              props: ['scope'],
              template: '<div class="chat-history-stub" :data-scope="scope" />',
            },
          },
        },
      })

    expect(mountTab(true).find('.editor-history-stub').exists()).toBe(true)
    expect(mountTab(false).find('.editor-history-stub').exists()).toBe(true)
    expect(
      mountTab(false).get('.chat-history-stub').attributes('data-scope')
    ).toBe('askAi')
  })
})
