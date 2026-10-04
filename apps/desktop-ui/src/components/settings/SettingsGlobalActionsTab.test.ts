import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_USER_CONFIG } from '@tyco/shared'
import SettingsGlobalActionsTab from './SettingsGlobalActionsTab.vue'

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../../lib/desktop/client', () => ({
  desktopClient: { listen: vi.fn().mockResolvedValue(() => {}) },
}))

const { callFunction } = vi.hoisted(() => ({
  callFunction: vi.fn(async (name: string) => ({
    success: true,
    result:
      name === 'getHotkeyProviderInfo'
        ? { provider: 'global-shortcut', canConfigure: false, actions: {} }
        : { status: 'ready' },
  })),
}))

vi.mock('../../stores/ipc', () => ({ useIpcStore: () => ({ callFunction }) }))

describe('SettingsGlobalActionsTab.vue', () => {
  const defaultProps = {
    userConfig: { ...DEFAULT_USER_CONFIG, submitKey: 'enter' as const },
  }

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
      props: ['value', 'options'],
      emits: ['update:value'],
      template: `
        <select
          class="field-select-stub"
          :value="value"
          @change="$emit('update:value', $event.target.value)"
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

  it('renders global hotkeys and application hotkeys sections with titles', () => {
    const wrapper = mount(SettingsGlobalActionsTab, {
      props: defaultProps,
      global: { stubs: globalStubs },
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

  it('renders submitKey row inside application hotkeys section and emits update:submit-key', async () => {
    const wrapper = mount(SettingsGlobalActionsTab, {
      props: defaultProps,
      global: { stubs: globalStubs },
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
    expect(select.props('value')).toBe('enter')

    await select.vm.$emit('update:value', 'ctrlEnter')

    expect(wrapper.emitted('update:submit-key')).toBeTruthy()
    expect(wrapper.emitted('update:submit-key')![0]).toEqual(['ctrlEnter'])
  })

  it('unassigns a hotkey', async () => {
    const wrapper = mount(SettingsGlobalActionsTab, {
      props: defaultProps,
      global: {
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

    expect(callFunction).toHaveBeenCalledWith('applyHotkey', [
      { mode: 'voice', shortcut: '' },
    ])
    expect(wrapper.emitted('update:hotkey')).toEqual([['voice', '']])
    // an unassigned hotkey offers no removal
    const editorRow = wrapper.find(
      '[data-label="settings.hotkeyActions.editor"]'
    )
    expect(editorRow.find('[title="settings.unassignHotkey"]').exists()).toBe(
      false
    )
  })
})
