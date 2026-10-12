import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import SettingsLlmTab from './SettingsLlmTab.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../../composables/use-toast', () => ({
  default: () => ({ toast: vi.fn(), toastText: vi.fn() }),
}))

vi.mock('../../stores/llm', () => ({
  useLlmStore: () => ({
    secrets: {},
    refreshSecrets: vi.fn().mockResolvedValue(undefined),
  }),
}))

describe('SettingsLlmTab.vue', () => {
  const baseLlmConfig = {
    providers: [],
    models: [],
    tasks: {
      translate: [],
      voiceCorrection: [],
      correction: [],
      aiTasks: [],
      chat: [],
    },
  }

  it('renders AI rules section with chat and correction fields', () => {
    const aiRules = {
      chat: 'Chat rule text',
      correction: 'Correction rule text',
      translate: 'Translate rule text',
      voiceCorrection: '',
    }

    const wrapper = mount(SettingsLlmTab, {
      props: { llm: baseLlmConfig, aiRules },
      global: {
        stubs: {
          SettingsSection: {
            props: ['title'],
            template:
              '<section class="section-stub" :data-title="title"><slot /></section>',
          },
          FieldRow: {
            props: ['label', 'hint', 'info', 'vertical'],
            template: `
              <div class="field-row-stub" :data-label="label" :data-info="info" :data-hint="hint">
                <slot />
              </div>
            `,
          },
          FieldTextArea: {
            props: ['value'],
            template: '<textarea class="textarea-stub" :value="value" />',
          },
          FieldInput: true,
          FieldSelect: true,
          Button: true,
          Icon: true,
        },
      },
    })

    const rulesSection = wrapper.find('[data-title="settings.aiRules"]')
    expect(rulesSection.exists()).toBe(true)

    const chatRow = wrapper.find('[data-label="settings.chatRules"]')
    expect(chatRow.exists()).toBe(true)

    const correctionRow = wrapper.find('[data-label="settings.textCorrection"]')
    expect(correctionRow.exists()).toBe(true)

    // Translation rules live on the translation settings page.
    expect(wrapper.findAll('.textarea-stub')).toHaveLength(2)
  })
})
