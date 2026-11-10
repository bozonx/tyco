import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { DEFAULT_USER_CONFIG, type UserConfig } from '@tyco/shared'

import type * as InputDevices from '../../lib/stt/input-devices'
import { useSecretsStore } from '../../stores/secrets'
import { createTestSettingsContext } from '../../test/settings-context'
import SettingsVoiceTab from './SettingsVoiceTab.vue'

const micMocks = vi.hoisted(() => ({
  listInputDevices: vi.fn().mockResolvedValue([
    { id: 'Built-in Mic', label: 'Built-in Mic', isDefault: true },
    { id: 'USB Mic', label: 'USB Mic', isDefault: false },
  ]),
  startTest: vi.fn().mockResolvedValue(undefined),
  stopTest: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../../lib/stt/input-devices', async (importOriginal) => {
  const actual = await importOriginal<typeof InputDevices>()
  return {
    ...actual,
    listInputDevices: micMocks.listInputDevices,
    createMicrophoneTester: () => ({
      start: micMocks.startTest,
      stop: micMocks.stopTest,
    }),
  }
})

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
        ...structuredClone(DEFAULT_USER_CONFIG.stt),
        provider: 'sherpaOnnx',
        correctionMode: 'off',
        isStylingBarEnabled: false,
        isStylingBarDirectInsertEnabled: false,
        providers: {
          deepgram: { modelId: 'nova-3', language: 'auto' },
          sherpaOnnx: { baseUrl: 'ws://localhost:6006' },
          geminiLive: { modelId: 'gemini-3.5-transcribe-live' },
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
            props: ['title', 'info'],
            template:
              '<section class="section-stub" :data-title="title" :data-info="info"><slot /></section>',
          },
          FieldRow: {
            props: ['label', 'hint', 'info'],
            template:
              '<div class="field-row-stub" :data-label="label"><slot /></div>',
          },
          FieldSelect: {
            props: ['modelValue', 'options'],
            template:
              '<select class="field-select-stub" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="option in options" :key="option.id" :value="option.id">{{ option.name }}</option></select>',
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
          FieldPromptTextArea: {
            props: ['modelValue'],
            template:
              '<textarea class="field-textarea-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          },
          SettingsTaskModel: {
            props: ['task'],
            template: '<div class="task-model-stub" :data-task="task" />',
          },
          SecretKeyField: {
            props: ['hasKey', 'save', 'remove', 'modelValue'],
            template:
              '<div class="secret-key-stub" :data-has-key="hasKey"><input class="secret-draft" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /><button class="save-key-btn" @click="save?.()">Save</button><button class="remove-key-btn" @click="remove?.()">Remove</button></div>',
          },
          ListenSourceField: { template: '<div class="listen-source-stub" />' },
          DeviceScopeBadge: { template: '<span class="device-scope-stub" />' },
          Button: {
            props: ['icon', 'variant', 'size'],
            emits: ['click'],
            template:
              '<button class="btn-stub" @click="$emit(\'click\')"><slot /></button>',
          },
          IconButton: {
            props: ['label', 'disabled'],
            emits: ['click'],
            template:
              '<button class="icon-btn-stub" :aria-label="label" :disabled="disabled" @click="$emit(\'click\')" />',
          },
          InlineAction: {
            emits: ['click'],
            template:
              '<button class="inline-action-stub" @click="$emit(\'click\')"><slot /></button>',
          },
        },
      },
    })
  }

  it('renders sherpa-onnx fields and hides API key and model fields', () => {
    const config = createConfig()
    const wrapper = mountTab(config)

    const sections = wrapper.findAll('.section-stub')
    expect(sections[0].attributes('data-title')).toBe('settings.sttTab')
    expect(sections[0].attributes('data-info')).toBe('settings.sttTabInfo')
    expect(sections[1].attributes('data-title')).toBe(
      'settings.sttDictationSection'
    )
    expect(sections[2].attributes('data-title')).toBe(
      'settings.sttListenSection'
    )

    const labels = wrapper
      .findAll('.field-row-stub')
      .map((f) => f.attributes('data-label'))
    expect(labels).toContain('settings.sttProvider')
    expect(labels).toContain('settings.sttServerUrl')
    expect(labels).toContain('settings.microphoneLabel')
    expect(labels).not.toContain('settings.apiKey')
    expect(labels).not.toContain('settings.model')
  })

  it('renders API key and model fields when provider is deepgram', async () => {
    const config = createConfig()
    config.stt.provider = 'deepgram'
    const wrapper = mountTab(config)

    const sections = wrapper.findAll('.section-stub')
    expect(sections[0].attributes('data-title')).toBe('settings.sttTab')
    expect(sections[0].attributes('data-info')).toBe('settings.sttTabInfo')
    expect(sections[1].attributes('data-title')).toBe(
      'settings.sttDictationSection'
    )

    const labels = wrapper
      .findAll('.field-row-stub')
      .map((f) => f.attributes('data-label'))
    expect(labels).toContain('settings.apiKey')
    expect(labels).toContain('settings.model')
    expect(labels).toContain('settings.sttLanguage')
    expect(labels).not.toContain('settings.sttServerUrl')
  })

  it('renders API key and model when provider is geminiLive', async () => {
    const config = createConfig()
    config.stt.provider = 'geminiLive'
    const wrapper = mountTab(config)

    const labels = wrapper
      .findAll('.field-row-stub')
      .map((f) => f.attributes('data-label'))
    expect(labels).toContain('settings.apiKey')
    expect(labels).toContain('settings.model')
    expect(labels).not.toContain('settings.sttLanguage')
    expect(labels).not.toContain('settings.sttServerUrl')
  })

  it('switches voice correction mode to reveal the model and rules fields for any provider', async () => {
    const config = createConfig()
    const wrapper = mountTab(config)

    expect(wrapper.find('.field-textarea-stub').exists()).toBe(false)

    const selects = wrapper.findAll('.field-select-stub')
    const correctionSelect = selects.at(-1)!
    await correctionSelect.setValue('live')

    expect(wrapper.find('.field-textarea-stub').exists()).toBe(true)
    expect(config.stt.correctionMode).toBe('live')

    config.stt.provider = 'geminiLive'
    await wrapper.vm.$nextTick()
    const labels = wrapper
      .findAll('.field-row-stub')
      .map((field) => field.attributes('data-label'))
    expect(labels).toContain('settings.voiceTextCorrection')
    expect(labels).toContain('settings.sttLlmRules')
  })

  it('toggles the styling bar setting and shows direct insert toggle', async () => {
    const config = createConfig()
    const wrapper = mountTab(config)

    const switches = wrapper.findAll('.field-switch-stub')
    const stylingSwitch = switches.at(0)
    expect(stylingSwitch).toBeDefined()
    expect(wrapper.findAll('.field-switch-stub')).toHaveLength(1)

    await stylingSwitch!.setValue(true)
    expect(config.stt.isStylingBarEnabled).toBe(true)

    const updatedSwitches = wrapper.findAll('.field-switch-stub')
    expect(updatedSwitches).toHaveLength(2)
    const directInsertSwitch = updatedSwitches.at(1)
    expect(directInsertSwitch).toBeDefined()

    await directInsertSwitch!.setValue(true)
    expect(config.stt.isStylingBarDirectInsertEnabled).toBe(true)
  })

  it('calls secretsStore when saving and removing API key', async () => {
    const secretsStore = useSecretsStore()
    const setSecretSpy = vi.spyOn(secretsStore, 'setSecret').mockResolvedValue()
    const removeSecretSpy = vi
      .spyOn(secretsStore, 'removeSecret')
      .mockResolvedValue()

    const config = createConfig({
      stt: {
        ...structuredClone(DEFAULT_USER_CONFIG.stt),
        provider: 'deepgram',
        correctionMode: 'off',
        isStylingBarEnabled: false,
        isStylingBarDirectInsertEnabled: false,
        providers: {
          deepgram: { modelId: 'nova-3', language: 'auto' },
          sherpaOnnx: { baseUrl: '' },
          geminiLive: { modelId: 'gemini-3.5-transcribe-live' },
        },
      },
    })
    const wrapper = mountTab(config)

    await wrapper.get('.secret-draft').setValue(' key ')
    const saveBtn = wrapper.find('.save-key-btn')
    await saveBtn.trigger('click')
    expect(setSecretSpy).toHaveBeenCalledWith('stt.deepgram', 'key')

    const removeBtn = wrapper.find('.remove-key-btn')
    await removeBtn.trigger('click')
    expect(removeSecretSpy).toHaveBeenCalled()
  })

  it('saves API key under llm.google when provider is geminiLive', async () => {
    const secretsStore = useSecretsStore()
    const setSecretSpy = vi.spyOn(secretsStore, 'setSecret').mockResolvedValue()

    const config = createConfig()
    config.stt.provider = 'geminiLive'
    const wrapper = mountTab(config)

    await wrapper.get('.secret-draft').setValue(' gemini-key ')
    const saveBtn = wrapper.find('.save-key-btn')
    await saveBtn.trigger('click')
    expect(setSecretSpy).toHaveBeenCalledWith('llm.google', 'gemini-key')
  })

  it('selects a microphone and toggles the microphone level test meter', async () => {
    const config = createConfig()
    const wrapper = mountTab(config)
    await flushPromises()

    const micRow = wrapper
      .findAll('.field-row-stub')
      .find(
        (row) => row.attributes('data-label') === 'settings.microphoneLabel'
      )
    expect(micRow).toBeDefined()
    const micSelect = micRow!.find('.field-select-stub')
    await micSelect.setValue('USB Mic')
    expect(config.stt.microphoneId).toBe('USB Mic')

    const testButton = micRow!.find('.btn-stub')
    expect(wrapper.find('[role="meter"]').exists()).toBe(false)
    await testButton.trigger('click')
    await flushPromises()

    expect(micMocks.startTest).toHaveBeenCalledWith('USB Mic')
    expect(wrapper.find('[role="meter"]').exists()).toBe(true)

    await testButton.trigger('click')
    await flushPromises()
    expect(micMocks.stopTest).toHaveBeenCalled()
    expect(wrapper.find('[role="meter"]').exists()).toBe(false)

    await micSelect.setValue('')
    expect(config.stt.microphoneId).toBeUndefined()
  })
})
