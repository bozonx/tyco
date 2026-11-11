import { flushPromises, mount } from '@vue/test-utils'
import { disposePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_USER_CONFIG,
  SUBMIT_KEYS,
  type HotkeyProviderInfo,
} from '@tyco/shared'
import { createTestSettingsContext } from '../../test/settings-context'
import SettingsGlobalActionsTab from './SettingsGlobalActionsTab.vue'
import {
  loadFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../../composables/use-toast', () => ({
  default: () => ({ toastKey: vi.fn(), toastText: vi.fn() }),
}))

const providerInfo = (
  provider: HotkeyProviderInfo['provider']
): HotkeyProviderInfo => ({
  provider,
  canConfigure: false,
  actions: {},
  systemTriggers: {},
  registered: true,
  defaults: {},
  commands: {},
  platform: 'linux',
})

describe('SettingsGlobalActionsTab.vue', () => {
  let desktop: TestDesktop

  beforeEach(async () => {
    desktop = await loadFakeDesktop()
    desktop.backend.handle('get_hotkey_provider_info', () =>
      providerInfo('global-shortcut')
    )
  })

  afterEach(() => desktop.dispose())

  afterEach(() => disposePinia(desktop.pinia))

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
      props: ['label', 'info'],
      template: `
        <div class="field-row-stub" :data-label="label" :data-info="info">
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
    FieldSwitch: {
      name: 'FieldSwitch',
      props: ['modelValue', 'disabled'],
      emits: ['update:modelValue'],
      template:
        '<button class="field-switch-stub" :data-checked="modelValue" :disabled="disabled" @click="$emit(\'update:modelValue\', !modelValue)" />',
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
    const rowLabels = wrapper
      .findAll('.field-row-stub')
      .map((r) => r.attributes('data-label'))
    for (const key of [
      'chat',
      'voiceChat',
      'voiceCommands',
      'correction',
      'history',
      'selectionCorrection',
    ]) {
      expect(rowLabels).not.toContain(`settings.hotkeyActions.${key}`)
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

    expect(desktop.backend.callsOf('apply_hotkey')).toEqual([])
    expect(context.draft.value.hotkeys.voice).toBe('')
    // an unassigned hotkey offers no removal
    const editorRow = wrapper.find(
      '[data-label="settings.hotkeyActions.editor"]'
    )
    expect(editorRow.find('[title="settings.unassignHotkey"]').exists()).toBe(
      false
    )
  })

  it('renders styling and transformation hotkey rows', () => {
    const wrapper = mount(SettingsGlobalActionsTab, {
      global: { provide: context.provide, stubs: globalStubs },
    })

    const stylingRow = wrapper.find(
      '[data-label="settings.hotkeyActions.styling"]'
    )
    expect(stylingRow.exists()).toBe(true)

    const transformationRow = wrapper.find(
      '[data-label="settings.hotkeyActions.transformation"]'
    )
    expect(transformationRow.exists()).toBe(true)

    const customTransformationRow = wrapper.find(
      '[data-label="settings.hotkeyActions.quickAiRequest"]'
    )
    expect(customTransformationRow.exists()).toBe(true)

    const voiceTransformationRow = wrapper.find(
      '[data-label="settings.hotkeyActions.voiceQuickAiRequest"]'
    )
    expect(voiceTransformationRow.exists()).toBe(true)
  })

  it('groups the voice hotkeys into their own section', async () => {
    const wrapper = mount(SettingsGlobalActionsTab, {
      global: { provide: context.provide, stubs: globalStubs },
    })
    await flushPromises()

    const voiceSection = wrapper.find(
      '[data-title="settings.voiceHotkeysTitle"]'
    )
    expect(voiceSection.exists()).toBe(true)
    const labels = voiceSection
      .findAll('.field-row-stub')
      .map((row) => row.attributes('data-label'))
    expect(labels).toEqual([
      'settings.hotkeyActions.voice',
      'settings.voiceHold.voice',
      'settings.hotkeyActions.voiceCommands',
      'settings.voiceHold.voiceCommands',
      'settings.hotkeyActions.listen',
      'settings.hotkeyActions.voiceQuickAiRequest',
      'settings.hotkeyActions.voiceScreenshotQuickAiRequest',
    ])
  })

  it.each([
    ['voice', 'isVoiceInputHoldEnabled'],
    ['voiceCommands', 'isVoiceCommandsHoldEnabled'],
  ] as const)(
    'turns Push-to-Talk on for the %s hotkey only',
    async (id, setting) => {
      const wrapper = mount(SettingsGlobalActionsTab, {
        global: { provide: context.provide, stubs: globalStubs },
      })
      await flushPromises()

      const holdRow = wrapper.find(`[data-label="settings.voiceHold.${id}"]`)
      expect(holdRow.attributes('data-info')).toBe(
        `settings.voiceHoldHint.${id}`
      )
      const switchComponent = holdRow.findComponent({ name: 'FieldSwitch' })
      expect(switchComponent.props('modelValue')).toBe(false)

      await switchComponent.vm.$emit('update:modelValue', true)
      const stt = context.draft.value.stt
      expect(stt[setting]).toBe(true)
      expect(
        stt.isVoiceInputHoldEnabled && stt.isVoiceCommandsHoldEnabled
      ).toBe(false)
    }
  )

  it('hides the Push-to-Talk toggles when the provider is external', async () => {
    desktop.backend.handle('get_hotkey_provider_info', () =>
      providerInfo('external')
    )

    const wrapper = mount(SettingsGlobalActionsTab, {
      global: { provide: context.provide, stubs: globalStubs },
    })
    await flushPromises()

    expect(wrapper.find('[data-label^="settings.voiceHold."]').exists()).toBe(
      false
    )
  })

  it('renders rows for all 3 action pages', () => {
    delete context.draft.value.isInDevelopment

    const wrapper = mount(SettingsGlobalActionsTab, {
      global: { provide: context.provide, stubs: globalStubs },
    })

    const rows = wrapper.findAll('.field-row-stub')
    expect(
      rows.some(
        (r) =>
          r.attributes('data-label') ===
          'settings.hotkeyActions.selectionActions'
      )
    ).toBe(true)
    expect(
      rows.some(
        (r) =>
          r.attributes('data-label') ===
          'settings.hotkeyActions.selectionActionsPage2'
      )
    ).toBe(true)
    expect(
      rows.some(
        (r) =>
          r.attributes('data-label') ===
          'settings.hotkeyActions.selectionActionsPage3'
      )
    ).toBe(true)
  })

  it('renders 5 custom action slots and handles action selection with takesSelection locking', async () => {
    const wrapper = mount(SettingsGlobalActionsTab, {
      global: { provide: context.provide, stubs: globalStubs },
    })

    const customSlots = wrapper.findAll('.custom-action-slot')
    expect(customSlots).toHaveLength(5)

    // Initially slot 0 has no action, takesSelection is true and switch is disabled
    const firstSwitch = customSlots[0].findComponent({ name: 'FieldSwitch' })
    expect(firstSwitch.props('modelValue')).toBe(true)
    expect(firstSwitch.props('disabled')).toBe(true)

    // Select translationMenu action (which strictly requires selection -> locked true)
    const firstSelect = customSlots[0].findComponent({ name: 'FieldSelect' })
    await firstSelect.vm.$emit('update:modelValue', 'standard:translationMenu')
    expect(context.draft.value.customActionSlots[0].action).toEqual({
      type: 'standard',
      actionId: 'translationMenu',
    })
    expect(firstSwitch.props('disabled')).toBe(true)
    expect(firstSwitch.props('modelValue')).toBe(true)

    // Select screenshotQuickAiRequest (screenshot -> locked false)
    await firstSelect.vm.$emit(
      'update:modelValue',
      'standard:screenshotQuickAiRequest'
    )
    expect(firstSwitch.props('disabled')).toBe(true)
    expect(firstSwitch.props('modelValue')).toBe(false)
    expect(context.draft.value.customActionSlots[0].takesSelection).toBe(false)

    // Select quickAiRequest (flexible -> enabled switch)
    await firstSelect.vm.$emit('update:modelValue', 'standard:quickAiRequest')
    expect(firstSwitch.props('disabled')).toBe(false)
    expect(firstSwitch.props('modelValue')).toBe(true)

    // Toggle switch
    await firstSwitch.vm.$emit('update:modelValue', false)
    expect(context.draft.value.customActionSlots[0].takesSelection).toBe(false)
  })

  it('renders visual group headers for global hotkeys', () => {
    const wrapper = mount(SettingsGlobalActionsTab, {
      global: { provide: context.provide, stubs: globalStubs },
    })

    const groupTitles = wrapper
      .findAll('.hotkey-group-title')
      .map((el) => el.text())

    expect(groupTitles).toEqual([
      'settings.hotkeyGroups.primary',
      'settings.hotkeyGroups.ai',
      'settings.hotkeyGroups.text',
      'settings.hotkeyGroups.tools',
      'settings.hotkeyGroups.actionPages',
    ])
  })
})
