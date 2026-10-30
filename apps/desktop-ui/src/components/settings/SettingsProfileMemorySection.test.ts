import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_USER_CONFIG,
  type AiProfile,
  type ProfileMemoryTopic,
  type UserConfig,
} from '@tyco/shared'

import SettingsProfileMemorySection from './SettingsProfileMemorySection.vue'
import {
  loadFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'

const mocks = vi.hoisted(() => ({
  listMemoryTopics: vi.fn().mockResolvedValue([]),
  readMemory: vi.fn(),
  writeMemory: vi.fn(),
  clearMemory: vi.fn(),
  runLlm: vi.fn(),
  toastKey: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('../../stores/ai-profiles', () => ({
  useAiProfilesStore: () => ({
    listMemoryTopics: mocks.listMemoryTopics,
    readMemory: mocks.readMemory,
    writeMemory: mocks.writeMemory,
    clearMemory: mocks.clearMemory,
  }),
}))

vi.mock('../../stores/llm', () => ({
  useLlmStore: () => ({ client: { run: mocks.runLlm } }),
}))

vi.mock('../../stores/secrets', () => ({
  useSecretsStore: () => ({ secrets: {} }),
}))

vi.mock('../../composables/use-toast', () => ({
  default: () => ({ toastKey: mocks.toastKey, toastError: mocks.toastError }),
}))

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params?.tokens) return `${key}:${params.tokens}`
      if (params?.file) return `${key}:${params.file}`
      return key
    },
  }),
}))

const baseProfile: AiProfile = {
  id: 'test-profile',
  name: 'Test Profile',
  memoryMode: 'auto',
  projectPermissions: {},
  createdAt: 1000,
  updatedAt: 1000,
}

describe('SettingsProfileMemorySection', () => {
  let desktop: TestDesktop

  beforeEach(async () => {
    const userConfig = structuredClone(DEFAULT_USER_CONFIG) as UserConfig
    userConfig.llm.providers = [
      {
        id: 'p1',
        type: 'openaiCompatible',
        name: 'Local',
        baseUrl: 'http://localhost:11434/v1',
      },
    ] as UserConfig['llm']['providers']
    userConfig.llm.models = [
      { id: 'fallback-model', providerId: 'p1', providerModelId: 'm1' },
    ] as UserConfig['llm']['models']
    desktop = await loadFakeDesktop({ userConfig })
  })

  afterEach(() => desktop.dispose())

  it('renders disabled notice when memoryMode is off', () => {
    const wrapper = mount(SettingsProfileMemorySection, {
      props: { profile: { ...baseProfile, memoryMode: 'off' } },
      global: {
        stubs: {
          SettingsSection: { template: '<div><slot /></div>' },
          FieldRow: { template: '<div><slot /></div>' },
          FieldSelect: true,
          InlineNotice: {
            props: ['message'],
            template: '<div class="notice">{{ message }}</div>',
          },
          Button: true,
        },
      },
    })

    expect(wrapper.find('.notice').text()).toBe(
      'settings.profileMemoryDisabledNotice'
    )
  })

  it('loads and lists memory topics', async () => {
    const topics: ProfileMemoryTopic[] = [
      { file: 'core.md', title: 'Core facts', bytes: 120, updatedAt: 1000 },
      {
        file: 'preferences.md',
        title: 'User style',
        bytes: 400,
        updatedAt: 1000,
      },
    ]
    mocks.listMemoryTopics.mockResolvedValue(topics)

    const wrapper = mount(SettingsProfileMemorySection, {
      props: { profile: baseProfile },
      global: {
        stubs: {
          SettingsSection: { template: '<div><slot /></div>' },
          FieldRow: { template: '<div><slot /></div>' },
          FieldSelect: true,
          SettingsEntityItem: {
            props: ['title', 'description'],
            template: `
              <div class="entity-item">
                <span class="title">{{ title }}</span>
                <span class="desc">{{ description }}</span>
                <slot name="actions" />
              </div>
            `,
          },
          Badge: true,
          IconButton: true,
          Button: true,
          BaseDialog: true,
          ConfirmModal: true,
          Diff: true,
        },
      },
    })

    await vi.waitFor(() => {
      expect(wrapper.findAll('.entity-item')).toHaveLength(2)
    })

    expect(wrapper.text()).toContain('core.md (Core facts)')
    expect(wrapper.text()).toContain('preferences.md — User style')
  })

  it('emits update:memoryMode when mode changes', () => {
    const wrapper = mount(SettingsProfileMemorySection, {
      props: { profile: baseProfile },
      global: {
        stubs: {
          SettingsSection: { template: '<div><slot /></div>' },
          FieldRow: { template: '<div><slot /></div>' },
          FieldSelect: {
            props: ['modelValue', 'options'],
            template: `
              <select :value="modelValue" @change="$emit('update:modelValue', $event.target.value)">
                <option value="auto">auto</option>
                <option value="ask">ask</option>
              </select>
            `,
          },
          Button: true,
          BaseDialog: true,
          ConfirmModal: true,
        },
      },
    })

    const select = wrapper.find('select')
    select.setValue('ask')

    expect(wrapper.emitted('update:memoryMode')?.[0]).toEqual(['ask'])
  })

  it('opens confirm modal on clear button click and clears memory', async () => {
    mocks.listMemoryTopics.mockResolvedValue([
      { file: 'core.md', title: 'Core', bytes: 10, updatedAt: 1000 },
    ])

    const wrapper = mount(SettingsProfileMemorySection, {
      props: { profile: baseProfile },
      global: {
        stubs: {
          SettingsSection: { template: '<div><slot /></div>' },
          FieldRow: { template: '<div><slot /></div>' },
          FieldSelect: true,
          SettingsEntityItem: true,
          Button: {
            props: ['disabled'],
            template:
              '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
          },
          ConfirmModal: {
            props: ['open'],
            template:
              '<div v-if="open" class="confirm-modal"><button class="confirm" @click="$emit(\'confirm\')">OK</button></div>',
          },
          BaseDialog: true,
        },
      },
    })

    await vi.waitFor(() => {
      expect(mocks.listMemoryTopics).toHaveBeenCalled()
    })

    // Find clear button
    const clearBtn = wrapper
      .findAll('button')
      .find((b) => b.text().includes('settings.profileMemoryClear'))
    await clearBtn?.trigger('click')

    expect(wrapper.find('.confirm-modal').exists()).toBe(true)

    // Confirm clear
    await wrapper.find('.confirm').trigger('click')
    expect(mocks.clearMemory).toHaveBeenCalledWith('test-profile')
    expect(mocks.toastKey).toHaveBeenCalledWith(
      'settings.profileMemoryClearSuccess',
      'info'
    )
  })

  it('compacts memory using fallback model when profile.modelId is undefined', async () => {
    mocks.listMemoryTopics.mockResolvedValue([
      { file: 'core.md', title: 'Core', bytes: 100, updatedAt: 1000 },
    ])
    mocks.readMemory.mockResolvedValue('# Core\n- Fact 1\n- Fact 1\n')
    mocks.runLlm.mockResolvedValue('# Core\n- Fact 1\n')

    const wrapper = mount(SettingsProfileMemorySection, {
      props: { profile: { ...baseProfile, modelId: undefined } },
      global: {
        stubs: {
          SettingsSection: { template: '<div><slot /></div>' },
          FieldRow: { template: '<div><slot /></div>' },
          FieldSelect: true,
          SettingsEntityItem: {
            template: '<div><slot name="actions" /></div>',
          },
          Badge: true,
          IconButton: {
            props: ['disabled'],
            template:
              '<button class="icon-btn" :disabled="disabled" @click="$emit(\'click\')"></button>',
          },
          Button: true,
          BaseDialog: true,
          ConfirmModal: true,
          Diff: true,
        },
      },
    })

    await vi.waitFor(() => {
      expect(wrapper.findAll('.icon-btn').length).toBeGreaterThan(0)
    })

    const compactBtn = wrapper.findAll('.icon-btn')[0]
    await compactBtn.trigger('click')

    expect(mocks.runLlm).toHaveBeenCalledWith(
      'chat',
      expect.anything(),
      expect.objectContaining({ modelId: 'fallback-model' })
    )
  })
})
