import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import SettingsLlmTab from './SettingsLlmTab.vue'

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../../composables/useToast', () => ({
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

  it('renders AI rules section with chat, correction and translate fields', () => {
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

    const translateRow = wrapper.find('[data-label="settings.llmTranslation"]')
    expect(translateRow.exists()).toBe(true)
    expect(translateRow.attributes('data-info')).toBe(
      'settings.llmTranslationHint'
    )
    expect(translateRow.attributes('data-hint')).toBeUndefined()
  })
})
