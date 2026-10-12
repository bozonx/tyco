import { DEFAULT_LLM_CONFIG } from '@tyco/shared'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import ConfirmModal from '../common/ConfirmModal.vue'
import SettingsLlmTab from './SettingsLlmTab.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
const mocks = vi.hoisted(() => ({
  setSecret: vi.fn().mockResolvedValue(undefined),
  removeSecret: vi.fn().mockResolvedValue(undefined),
  refreshSecrets: vi.fn().mockResolvedValue(undefined),
  toast: vi.fn(),
  toastText: vi.fn(),
}))
vi.mock('../../stores/llm', () => ({
  useLlmStore: () => ({ ...mocks, secrets: {}, vaultState: 'available' }),
}))
vi.mock('../../composables/use-toast', () => ({
  default: () => ({ toast: mocks.toast, toastText: mocks.toastText }),
}))

function setup() {
  const llm = reactive(structuredClone(DEFAULT_LLM_CONFIG))
  const wrapper = mount(SettingsLlmTab, {
    props: { llm },
    global: { stubs: { BaseDialog: true } },
  })
  const localCard = () =>
    wrapper
      .findAll('.connection-card')
      .find((card) => card.text().includes('Ollama'))!
  return { llm, wrapper, localCard }
}

describe('LLM settings cards', () => {
  beforeEach(() => vi.clearAllMocks())

  it('edits the shared provider draft and updates the card summary', async () => {
    const { llm, localCard } = setup()
    const card = localCard()
    await card.get('.connection-summary').trigger('click')
    await card.get('input[placeholder="Ollama"]').setValue('Local model server')
    await card
      .get('input[placeholder="http://localhost:11434/v1"]')
      .setValue('http://models.lan/v1')
    expect(
      llm.providers.find((provider) => provider.id === 'local')
    ).toMatchObject({
      name: 'Local model server',
      baseUrl: 'http://models.lan/v1',
    })
    expect(card.get('.connection-title').text()).toContain('Local model server')
    expect(card.get('.connection-meta').text()).toContain(
      'http://models.lan/v1'
    )
  })

  it('saves a key using the updated provider origin and clears its draft', async () => {
    const { localCard } = setup()
    const card = localCard()
    await card.get('.connection-summary').trigger('click')
    await card
      .get('input[placeholder="http://localhost:11434/v1"]')
      .setValue('http://models.lan/v1')
    const keyField = card.get('.secret-key-field')
    await keyField.get('input').setValue('new-secret')
    await keyField.findAll('button')[0].trigger('click')
    await flushPromises()
    expect(mocks.setSecret).toHaveBeenCalledWith('local', 'new-secret', [
      'http://models.lan',
    ])
    expect((keyField.get('input').element as HTMLInputElement).value).toBe('')
  })

  it('adds a model through the card and keeps removal behind the parent confirmation', async () => {
    const { llm, wrapper, localCard } = setup()
    const card = localCard()
    await card.get('.connection-summary').trigger('click')
    const count = llm.models.length
    await card.get('.models-header button').trigger('click')
    expect(llm.models).toHaveLength(count + 1)
    expect(llm.models.at(-1)?.provider).toBe('local')
    expect(card.findAll('.model-row')).toHaveLength(2)
    const remove = card
      .findAll('.connection-actions button')
      .find((button) => button.text() === 'settings.removeProvider')!
    await remove.trigger('click')
    expect(llm.providers.some((provider) => provider.id === 'local')).toBe(true)
    const confirmation = wrapper.getComponent(ConfirmModal)
    expect(confirmation.props('open')).toBe(true)
    confirmation.vm.$emit('cancel')
    await flushPromises()
    expect(llm.providers.some((provider) => provider.id === 'local')).toBe(true)
    await remove.trigger('click')
    confirmation.vm.$emit('confirm')
    await flushPromises()
    expect(llm.providers.some((provider) => provider.id === 'local')).toBe(
      false
    )
    expect(llm.models.some((model) => model.provider === 'local')).toBe(false)
    expect(wrapper.emitted('providerRemoved')).toEqual([['local']])
  })
})

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
