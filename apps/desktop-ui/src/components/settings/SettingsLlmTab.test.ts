import { DEFAULT_LLM_CONFIG, type UserConfig } from '@tyco/shared'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ConfirmModal from '../common/ConfirmModal.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import InfoTooltip from '../common/InfoTooltip.vue'
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
    model.name = ''
    const card = localCard()
    await card.get('.disclosure-header').trigger('click')
    const row = card.get('.model-row')
    await row.get('input').setValue('custom-model')
    expect(model.providerModelId).toBe('custom-model')
    expect(row.get('.model-row-header').text()).toBe('custom-model')
    await row.get('.advanced-toggle button').trigger('click')
    const name = row.get('input[placeholder="custom-model"]')
    await name.setValue('Local chat model')
    expect(model.name).toBe('Local chat model')
    expect(row.get('.model-row-header').text()).toBe('Local chat model')
    await row.get('input[type="checkbox"]').setValue(true)
    expect(model.canUseImages).toBe(true)
    const toolUseRow = wrapper
      .findAllComponents(FieldRow)
      .find((field) => field.props('label') === 'settings.toolUse')!
    expect(toolUseRow.props('info')).toBe('settings.toolUseHint')
    expect(toolUseRow.props('hint')).toBeUndefined()
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
    const headerTooltip = card.get('.models-header').findComponent(InfoTooltip)
    expect(headerTooltip.props('text')).toBe('settings.connectionModelsHint')
    const count = llm.models.length
    const addButton = card
      .findAll('.models-header button')
      .find((button) => button.text().includes('settings.addModel'))!
    await addButton.trigger('click')
    expect(llm.models).toHaveLength(count)
    expect(card.findAll('.model-row')).toHaveLength(2)
    const draftRow = card.findAll('.model-row')[0]
    expect(draftRow.get('.model-row-header').text()).toBe('')
    await draftRow.get('input').setValue('q')
    expect(llm.models).toHaveLength(count + 1)
    expect(llm.models[0]).toMatchObject({
      providerId: 'ollama',
      providerModelId: 'q',
    })
    expect(card.findAll('.model-row')).toHaveLength(2)
    const remove = card
      .findAll('.connection-actions button')
      .find((button) => button.text() === 'settings.removeProvider')!
    await remove.trigger('click')
    expect(llm.providers.some((provider) => provider.id === 'ollama')).toBe(
      true
    )
    const confirmation = wrapper.findAllComponents(ConfirmModal).at(-1)!
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

  it('discards an unsaved model without a confirmation', async () => {
    const { llm, localCard } = setup()
    const card = localCard()
    await card.get('.disclosure-header').trigger('click')
    const count = llm.models.length
    await card
      .findAll('.models-header button')
      .find((button) => button.text().includes('settings.addModel'))!
      .trigger('click')
    const draftRow = card.findAll('.model-row')[0]
    await draftRow.get('input').setValue(' ')
    expect(llm.models).toHaveLength(count)
    await draftRow
      .get('button[aria-label="settings.removeModel"]')
      .trigger('click')
    expect(card.getComponent(ConfirmModal).props('open')).toBe(false)
    expect(card.findAll('.model-row')).toHaveLength(1)
    expect(llm.models).toHaveLength(count)
  })

  it('shows the thinking mode only for DeepSeek models', async () => {
    const { llm, wrapper, localCard } = setup()
    const thinkingRows = () =>
      wrapper
        .findAllComponents(FieldRow)
        .filter((field) => field.props('label') === 'settings.thinkingMode')
    const deepseek = wrapper
      .findAll('.connection-card')
      .find((card) => card.text().includes('DeepSeek'))!
    await deepseek.get('.disclosure-header').trigger('click')
    await deepseek.get('.model-row .advanced-toggle button').trigger('click')
    expect(thinkingRows()).toHaveLength(1)
    await thinkingRows()[0].get('input[type="checkbox"]').setValue(true)
    expect(
      llm.models.find((model) => model.providerId === 'deepseek')
        ?.isThinkingEnabled
    ).toBe(true)

    const local = localCard()
    await local.get('.disclosure-header').trigger('click')
    await local.get('.model-row .advanced-toggle button').trigger('click')
    expect(local.findAll('.model-row input[type="checkbox"]')).toHaveLength(2)
    expect(thinkingRows()).toHaveLength(1)
  })

  it('confirms model removal before deleting it from the card', async () => {
    const { llm, localCard } = setup()
    const card = localCard()
    await card.get('.disclosure-header').trigger('click')
    const initialModelsCount = card.findAll('.model-row').length
    expect(initialModelsCount).toBeGreaterThan(0)

    const modelRow = card.get('.model-row')
    const trashButton = modelRow.get(
      'button[aria-label="settings.removeModel"]'
    )
    expect(trashButton.classes()).toContain('btn-ghost')
    expect(trashButton.classes()).not.toContain('btn-danger-ghost')

    await trashButton.trigger('click')

    const modelConfirm = card.getComponent(ConfirmModal)
    expect(modelConfirm.props('open')).toBe(true)
    expect(modelConfirm.props('title')).toBe('settings.removeModel')
    expect(modelConfirm.props('message')).toBe('settings.removeModelConfirm')

    modelConfirm.vm.$emit('cancel')
    await flushPromises()
    expect(card.findAll('.model-row')).toHaveLength(initialModelsCount)

    await trashButton.trigger('click')
    expect(modelConfirm.props('open')).toBe(true)

    modelConfirm.vm.$emit('confirm')
    await flushPromises()
    expect(card.findAll('.model-row')).toHaveLength(initialModelsCount - 1)
    expect(llm.models.some((model) => model.id === 'ollama-qwen')).toBe(false)
  })
})

describe('feature models', () => {
  it('sets one model for all features', async () => {
    const { llm, wrapper } = setup()
    const allSelect = wrapper.findAllComponents(FieldSelect).at(-2)!
    expect(allSelect.props('modelValue')).toBe('ollama-qwen')

    allSelect.vm.$emit('update:modelValue', 'gemini-flash')
    await flushPromises()
    expect(llm.tasks.translation.modelId).toBe('gemini-flash')
    expect(llm.tasks.correction.modelId).toBe('gemini-flash')
    expect(llm.tasks.aiTask.modelId).toBe('gemini-flash')
    expect(llm.commonModelId).toBe('gemini-flash')
  })

  it('switches between all and per-feature mode while preserving choices', async () => {
    const { llm, wrapper } = setup()
    const modeControl = wrapper.findComponent({ name: 'SegmentedControl' })
    expect(modeControl.props()['modelValue']).toBe('all')

    // Switch to per-feature
    modeControl.vm.$emit('update:modelValue', 'perTask')
    await flushPromises()

    const selects = wrapper.findAllComponents(FieldSelect)
    const translation = selects.at(-7)!
    const options = translation.props('options') as { id: string }[]
    expect(options[0]).toEqual({ id: '', name: 'settings.taskModelNone' })
    expect(options.map((option) => option.id)).toContain('gemini-flash')
    expect(translation.props('modelValue')).toBe('ollama-qwen')

    // Change translation model in per-task mode
    translation.vm.$emit('update:modelValue', 'gemini-flash')
    await flushPromises()
    expect(llm.tasks.translation.modelId).toBe('gemini-flash')
    expect(llm.tasks.correction.modelId).toBe('ollama-qwen')
    expect(llm.customTaskModels?.translation).toBe('gemini-flash')

    // Switch back to all
    modeControl.vm.$emit('update:modelValue', 'all')
    await flushPromises()
    expect(llm.tasks.translation.modelId).toBe('ollama-qwen')
    expect(llm.tasks.correction.modelId).toBe('ollama-qwen')
    expect(llm.commonModelId).toBe('ollama-qwen')

    // Change common model to deepseek-flash in all mode
    const allSelect = wrapper.findAllComponents(FieldSelect).at(-2)!
    allSelect.vm.$emit('update:modelValue', 'deepseek-flash')
    await flushPromises()
    expect(llm.tasks.translation.modelId).toBe('deepseek-flash')
    expect(llm.tasks.correction.modelId).toBe('deepseek-flash')
    expect(llm.commonModelId).toBe('deepseek-flash')
    expect(llm.customTaskModels?.translation).toBe('gemini-flash')

    // Switch back to per-task: translation restores to gemini-flash!
    modeControl.vm.$emit('update:modelValue', 'perTask')
    await flushPromises()
    expect(llm.tasks.translation.modelId).toBe('gemini-flash')
    expect(llm.tasks.correction.modelId).toBe('ollama-qwen')
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
      transformation: { modelId: '' },
      styling: { modelId: '' },
    },
    imageQuality: 'balanced',
  }

  it('leaves prompts and chat settings to their feature pages', async () => {
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
          SegmentedControl: {
            name: 'SegmentedControl',
            props: ['modelValue'],
            template:
              '<div class="segmented-control-stub" :data-value="modelValue" />',
          },
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
    ).toEqual(['settings.chatImageQuality'])

    const modeControl = wrapper.findComponent({ name: 'SegmentedControl' })
    modeControl.vm.$emit('update:modelValue', 'perTask')
    await flushPromises()

    expect(
      wrapper
        .findAll('.field-row-stub')
        .map((row) => row.attributes('data-label'))
    ).toEqual([
      'action.translationMenu',
      'settings.voiceTextCorrection',
      'settings.textCorrection',
      'settings.tasksTab',
      'settings.transformationsTab',
      'settings.stylingTab',
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
