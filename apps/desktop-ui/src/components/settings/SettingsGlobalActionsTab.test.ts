import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_USER_CONFIG, SUBMIT_KEYS } from '@tyco/shared'
import { createTestSettingsContext } from '../../test/settings-context'
import SettingsGlobalActionsTab from './SettingsGlobalActionsTab.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../../composables/use-toast', () => ({
  default: () => ({ toastKey: vi.fn(), toastText: vi.fn() }),
}))

vi.mock('../../lib/desktop/client', () => ({
  desktopClient: { listen: vi.fn().mockResolvedValue(() => {}) },
}))

const { call } = vi.hoisted(() => ({
  call: vi.fn(async (name: string) => ({
    success: true,
    result:
      name === 'get_hotkey_provider_info'
        ? { provider: 'global-shortcut', canConfigure: false, actions: {} }
        : { status: 'ready' },
  })),
}))

vi.mock('../../stores/ipc', () => ({ useIpcStore: () => ({ call }) }))
vi.mock('../../stores/desktop', async () => {
  const { mockDesktopStore } = await import('../../test/desktop-store')
  return {
    useDesktopStore: () =>
      mockDesktopStore(() => ({ userConfig: DEFAULT_USER_CONFIG })),
  }
})

describe('SettingsGlobalActionsTab.vue', () => {
  let pinia: ReturnType<typeof createPinia>
  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.clearAllMocks()
  })
  afterEach(() => disposePinia(pinia))

  let context: ReturnType<typeof createTestSettingsContext>
  beforeEach(() => {
    context = createTestSettingsContext({
      ...structuredClone(DEFAULT_USER_CONFIG),
      isInDevelopment: true,
      editor: { ...DEFAULT_USER_CONFIG.editor, submitKey: 'Enter' },
    })
  })

  const globalStubs = {
    SettingsSection: {
      props: ['title', 'info'],
      template: `
        <section class="section-stub" :data-title="title" :data-info="info">
          <slot name="actions" />
          <slot />
        </section>
      `,
    },
    FieldRow: {
      props: ['label'],
      template: `
        <div class="field-row-stub" :data-label="label">
          <slot name="info" />
          <slot />
        </div>
      `,
    },
    FieldSelect: {
      name: 'FieldSelect',
      props: ['modelValue', 'options'],
      emits: ['update:modelValue'],
      template: `
        <select
          class="field-select-stub"
          :value="modelValue"
          @change="$emit('update:modelValue', $event.target.value)"
        >
          <option v-for="opt in options" :key="opt.id" :value="opt.id">
            {{ opt.name }}
          </option>
        </select>
      `,
    },
    HotkeyInput: true,
    InfoTooltip: true,
    Button: true,
    Icon: true,
  }

  it('hides development hotkeys without changing their saved values', () => {
    delete context.draft.value.isInDevelopment
    const wrapper = mount(SettingsGlobalActionsTab, {
      global: { provide: context.provide, stubs: globalStubs },
    })
    for (const key of [
      'chat',
      'voiceChat',
      'voiceCommands',
      'correction',
      'selectionCorrection',
    ]) {
      expect(wrapper.text()).not.toContain(`settings.hotkeyActions.${key}`)
    }
    expect(context.draft.value.hotkeys.selectionCorrection).toBe(
      DEFAULT_USER_CONFIG.hotkeys.selectionCorrection
    )
  })

  it('renders global hotkeys and application hotkeys sections with titles', () => {
    const wrapper = mount(SettingsGlobalActionsTab, {
      global: { provide: context.provide, stubs: globalStubs },
    })

    const sections = wrapper.findAll('.section-stub')
    expect(sections.length).toBeGreaterThanOrEqual(2)

    const globalSection = sections.find(
      (s) => s.attributes('data-title') === 'settings.globalHotkeysTitle'
    )
    expect(globalSection).toBeDefined()

    const appSection = sections.find(
      (s) => s.attributes('data-title') === 'settings.appHotkeysTitle'
    )
    expect(appSection).toBeDefined()
    expect(appSection?.attributes('data-info')).toBe('settings.appHotkeysHint')
  })

  it('renders submitKey row inside application hotkeys section and stores the submit key', async () => {
    const wrapper = mount(SettingsGlobalActionsTab, {
      global: { provide: context.provide, stubs: globalStubs },
    })

    const appSection = wrapper
      .findAll('.section-stub')
      .find((s) => s.attributes('data-title') === 'settings.appHotkeysTitle')

    expect(appSection).toBeDefined()
    const submitKeyRow = appSection!.find(
      '[data-label="settings.submitKey.label"]'
    )
    expect(submitKeyRow.exists()).toBe(true)

    const select = submitKeyRow.findComponent({ name: 'FieldSelect' })
    expect(select.exists()).toBe(true)
    expect(select.props('modelValue')).toBe('Enter')
    expect(
      (select.props('options') as { id: string }[]).map((option) => option.id)
    ).toEqual([...SUBMIT_KEYS])

    await select.vm.$emit('update:modelValue', 'Ctrl+Enter')

    expect(context.draft.value.editor.submitKey).toBe('Ctrl+Enter')
  })

  it('unassigns a hotkey', async () => {
    const wrapper = mount(SettingsGlobalActionsTab, {
      global: {
        provide: context.provide,
        stubs: {
          ...globalStubs,
          Button: {
            props: ['title'],
            // the click listener falls through to the button
            template: '<button :title="title" />',
          },
        },
      },
    })
    await flushPromises()

    const voiceRow = wrapper.find('[data-label="settings.hotkeyActions.voice"]')
    await voiceRow.find('[title="settings.unassignHotkey"]').trigger('click')
    await flushPromises()

    expect(call.mock.calls.some(([name]) => name === 'apply_hotkey')).toBe(
      false
    )
    expect(context.draft.value.hotkeys.voice).toBe('')
    // an unassigned hotkey offers no removal
    const editorRow = wrapper.find(
      '[data-label="settings.hotkeyActions.editor"]'
    )
    expect(editorRow.find('[title="settings.unassignHotkey"]').exists()).toBe(
      false
    )
  })
})
