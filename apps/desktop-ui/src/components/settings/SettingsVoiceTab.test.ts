import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { DEFAULT_USER_CONFIG, type UserConfig } from '@tyco/shared'

import { useSecretsStore } from '../../stores/secrets'
import { createTestSettingsContext } from '../../test/settings-context'
import SettingsVoiceTab from './SettingsVoiceTab.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('SettingsVoiceTab.vue', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.clearAllMocks()
  })

  function createConfig(overrides: Partial<UserConfig> = {}): UserConfig {
    return reactive({
      ...structuredClone(DEFAULT_USER_CONFIG),
      stt: {
        provider: 'sherpaOnnx',
        isLlmFormattingEnabled: false,
        providers: {
          deepgram: { modelId: 'nova-3', language: 'user' },
          sherpaOnnx: { baseUrl: 'ws://localhost:6006' },
        },
      },
      ...overrides,
    }) as UserConfig
  }

  const mountTab = (userConfig: UserConfig) => {
    return mount(SettingsVoiceTab, {
      global: {
        provide: createTestSettingsContext(userConfig).provide,
        stubs: {
          SettingsSection: {
            props: ['title'],
            template:
              '<section class="section-stub" :data-title="title"><slot /></section>',
          },
          FieldRow: {
            props: ['label', 'hint'],
            template:
              '<div class="field-row-stub" :data-label="label"><slot /></div>',
          },
          FieldSelect: {
            props: ['modelValue', 'options'],
            template:
              '<select class="field-select-stub" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)" />',
          },
          FieldInput: {
            props: ['modelValue'],
            template:
              '<input class="field-input-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          },
          FieldSwitch: {
            props: ['modelValue'],
            template:
              '<input type="checkbox" class="field-switch-stub" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
          },
          FieldTextArea: {
            props: ['modelValue'],
            template:
              '<textarea class="field-textarea-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          },
          SecretKeyField: {
            props: ['hasKey', 'save', 'remove'],
            template:
              '<div class="secret-key-stub" :data-has-key="hasKey"><button class="save-key-btn" @click="save?.()">Save</button><button class="remove-key-btn" @click="remove?.()">Remove</button></div>',
          },
        },
      },
    })
  }

  it('renders sherpa-onnx fields and hides API key and model fields', () => {
    const config = createConfig()
    const wrapper = mountTab(config)

    const labels = wrapper
      .findAll('.field-row-stub')
      .map((f) => f.attributes('data-label'))
    expect(labels).toContain('settings.sttProvider')
    expect(labels).toContain('settings.sttServerUrl')
    expect(labels).not.toContain('settings.apiKey')
    expect(labels).not.toContain('settings.model')
  })

  it('renders API key and model fields when provider is deepgram', async () => {
    const config = createConfig()
    config.stt.provider = 'deepgram'
    const wrapper = mountTab(config)

    const labels = wrapper
      .findAll('.field-row-stub')
      .map((f) => f.attributes('data-label'))
    expect(labels).toContain('settings.apiKey')
    expect(labels).toContain('settings.model')
    expect(labels).toContain('settings.sttLanguage')
    expect(labels).not.toContain('settings.sttServerUrl')
  })

  it('toggles the LLM formatting to reveal the rules field', async () => {
    const config = createConfig()
    const wrapper = mountTab(config)

    expect(wrapper.find('.field-textarea-stub').exists()).toBe(false)

    const switchInput = wrapper.find('.field-switch-stub')
    await switchInput.setValue(true)

    expect(wrapper.find('.field-textarea-stub').exists()).toBe(true)
    expect(config.stt.isLlmFormattingEnabled).toBe(true)
  })

  it('calls secretsStore when saving and removing API key', async () => {
    const secretsStore = useSecretsStore()
    const setSecretSpy = vi.spyOn(secretsStore, 'setSecret').mockResolvedValue()
    const removeSecretSpy = vi
      .spyOn(secretsStore, 'removeSecret')
      .mockResolvedValue()

    const config = createConfig({
      stt: {
        provider: 'deepgram',
        isLlmFormattingEnabled: false,
        providers: {
          deepgram: { modelId: 'nova-3', language: 'auto' },
          sherpaOnnx: { baseUrl: '' },
        },
      },
    })
    const wrapper = mountTab(config)

    const saveBtn = wrapper.find('.save-key-btn')
    await saveBtn.trigger('click')
    expect(setSecretSpy).toHaveBeenCalled()

    const removeBtn = wrapper.find('.remove-key-btn')
    await removeBtn.trigger('click')
    expect(removeSecretSpy).toHaveBeenCalled()
  })
})
