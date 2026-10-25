import { DEFAULT_LLM_CONFIG, type UserConfig } from '@tyco/shared'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ConfirmModal from '../common/ConfirmModal.vue'
import FieldSelect from '../common/FieldSelect.vue'
import { createTestSettingsContext } from '../../test/settings-context'
import SettingsLlmTab from './SettingsLlmTab.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
const mocks = vi.hoisted(() => ({
  setSecret: vi.fn().mockResolvedValue(undefined),
  removeSecret: vi.fn().mockResolvedValue(undefined),
  refreshSecrets: vi.fn().mockResolvedValue(undefined),
  toastKey: vi.fn(),
  toastText: vi.fn(),
}))
vi.mock('../../stores/secrets', () => ({
  useSecretsStore: () => ({ ...mocks, secrets: {}, vaultState: 'available' }),
}))
vi.mock('../../composables/use-toast', () => ({
  default: () => ({ toastKey: mocks.toastKey, toastText: mocks.toastText }),
}))

function setup() {
  const context = createTestSettingsContext({
    llm: structuredClone(DEFAULT_LLM_CONFIG),
  })
  const llm = context.draft.value.llm
  const wrapper = mount(SettingsLlmTab, {
    global: { provide: context.provide, stubs: { BaseDialog: true } },
  })
  const localCard = () =>
    wrapper
      .findAll('.connection-card')
      .find((card) => card.text().includes('Ollama'))!
  return { context, llm, wrapper, localCard }
}

describe('LLM settings cards', () => {
  beforeEach(() => vi.clearAllMocks())

  it('edits the shared provider draft and updates the card summary', async () => {
    const { llm, localCard } = setup()
    const card = localCard()
    await card.get('.disclosure-header').trigger('click')
    await card.get('input[placeholder="Ollama"]').setValue('Local model server')
    await card
      .get('input[placeholder="http://localhost:11434/v1"]')
      .setValue('http://models.lan/v1')
    expect(
      llm.providers.find((provider) => provider.id === 'ollama')
    ).toMatchObject({
      name: 'Local model server',
      baseUrl: 'http://models.lan/v1',
    })
    expect(card.get('.disclosure-title').text()).toContain('Local model server')
    expect(card.get('.disclosure-description').text()).toContain(
      'http://models.lan/v1'
    )
  })

  it('updates model fields through the model editor and preserves invalid numeric drafts', async () => {
    const { llm, localCard, wrapper } = setup()
    const model = llm.models.find((item) => item.providerId === 'ollama')!
    const card = localCard()
    await card.get('.disclosure-header').trigger('click')
    const row = card.get('.model-row')
    const inputs = row.findAll('input')
    await inputs[0].setValue('Local chat model')
    await inputs[1].setValue('custom-model')
    expect(model.name).toBe('Local chat model')
    expect(model.providerModelId).toBe('custom-model')
    await row.get('.advanced-toggle button').trigger('click')
    await row.get('input[type="checkbox"]').setValue(true)
    expect(model.canUseImages).toBe(true)
    const temperature = row.get('input[type="number"]')
    const previousTemperature = model.temperature
    await temperature.setValue('3')
    expect(temperature.attributes('aria-invalid')).toBe('true')
    expect(model.temperature).toBe(previousTemperature)
    await temperature.setValue('0.7')
    expect(model.temperature).toBe(0.7)
    expect(temperature.attributes('aria-invalid')).toBeUndefined()
    await temperature.setValue('')
    expect(model.temperature).toBeUndefined()
    wrapper.unmount()
  })

  it('saves a key using the updated provider origin and clears its draft', async () => {
    const { localCard } = setup()
    const card = localCard()
    await card.get('.disclosure-header').trigger('click')
    await card
      .get('input[placeholder="http://localhost:11434/v1"]')
      .setValue('http://models.lan/v1')
    const keyField = card.get('.secret-key-field')
    await keyField.get('input').setValue('new-secret')
    await keyField.findAll('button')[0].trigger('click')
    await flushPromises()
    expect(mocks.setSecret).toHaveBeenCalledWith('llm.ollama', 'new-secret', [
      'http://models.lan',
    ])
    expect((keyField.get('input').element as HTMLInputElement).value).toBe('')
  })

  it('adds a model through the card and keeps removal behind the parent confirmation', async () => {
    const { context, llm, wrapper, localCard } = setup()
    const card = localCard()
    await card.get('.disclosure-header').trigger('click')
    const count = llm.models.length
    await card.get('.models-header button').trigger('click')
    expect(llm.models).toHaveLength(count + 1)
    expect(llm.models.at(-1)?.providerId).toBe('ollama')
    expect(card.findAll('.model-row')).toHaveLength(2)
    const remove = card
      .findAll('.connection-actions button')
      .find((button) => button.text() === 'settings.removeProvider')!
    await remove.trigger('click')
    expect(llm.providers.some((provider) => provider.id === 'ollama')).toBe(
      true
    )
    const confirmation = wrapper.getComponent(ConfirmModal)
    expect(confirmation.props('open')).toBe(true)
    confirmation.vm.$emit('cancel')
    await flushPromises()
    expect(llm.providers.some((provider) => provider.id === 'ollama')).toBe(
      true
    )
    await remove.trigger('click')
    confirmation.vm.$emit('confirm')
    await flushPromises()
    expect(llm.providers.some((provider) => provider.id === 'ollama')).toBe(
      false
    )
    expect(llm.models.some((model) => model.providerId === 'ollama')).toBe(
      false
    )
    expect(context.deps.persist).toHaveBeenCalled()
  })
})

describe('feature models', () => {
  it('picks one model per feature, or none', async () => {
    const { llm, wrapper } = setup()
    const selects = wrapper.findAllComponents(FieldSelect)
    const translation = selects.at(-5)!
    const options = translation.props('options') as { id: string }[]
    expect(options[0]).toEqual({ id: '', name: 'settings.taskModelNone' })
    expect(options.map((option) => option.id)).toContain('gemini-flash')
    expect(translation.props('modelValue')).toBe('ollama-qwen')

    translation.vm.$emit('update:modelValue', 'gemini-flash')
    await flushPromises()
    expect(llm.tasks.translation.modelId).toBe('gemini-flash')

    translation.vm.$emit('update:modelValue', '')
    await flushPromises()
    expect(llm.tasks.translation.modelId).toBe('')
    expect(wrapper.text()).not.toContain('settings.addFallback')
  })
})

describe('SettingsLlmTab.vue', () => {
  const baseLlmConfig = {
    providers: [],
    models: [],
    tasks: {
      chat: { rule: '' },
      correction: { modelId: '', rule: '' },
      translation: { modelId: '', rule: '', qualityGateRule: '' },
      voiceCorrection: { modelId: '', rule: '' },
      aiTask: { modelId: '' },
    },
    imageQuality: 'balanced',
  }

  it('leaves prompts and chat settings to their feature pages', () => {
    const llm = {
      ...baseLlmConfig,
      tasks: {
        ...baseLlmConfig.tasks,
        chat: { rule: 'Chat rule text' },
        correction: { modelId: '', rule: 'Correction rule text' },
      },
    }

    const wrapper = mount(SettingsLlmTab, {
      global: {
        provide: createTestSettingsContext({
          isInDevelopment: true,
          llm: llm as unknown as UserConfig['llm'],
        }).provide,
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
            props: ['modelValue'],
            template: '<textarea class="textarea-stub" :value="modelValue" />',
          },
          FieldInput: true,
          FieldSelect: true,
          Button: true,
          Icon: true,
        },
      },
    })

    expect(wrapper.find('[data-title="settings.chat"]').exists()).toBe(false)
    expect(wrapper.findAll('.textarea-stub')).toHaveLength(0)
    expect(
      wrapper
        .findAll('.field-row-stub')
        .map((row) => row.attributes('data-label'))
    ).toEqual([
      'action.translationMenu',
      'settings.voiceTextCorrection',
      'settings.textCorrection',
      'settings.tasksTab',
      'settings.chatImageQuality',
    ])
  })
})

describe('image quality', () => {
  it('is set once for every chat', async () => {
    const { llm, wrapper } = setup()
    const quality = wrapper.findAllComponents(FieldSelect).at(-1)!
    expect(quality.props('modelValue')).toBe('balanced')
    expect(
      (quality.props('options') as { id: string }[]).map(({ id }) => id)
    ).toEqual(['economy', 'balanced', 'original'])

    quality.vm.$emit('update:modelValue', 'original')
    await flushPromises()
    expect(llm.imageQuality).toBe('original')
  })
})
