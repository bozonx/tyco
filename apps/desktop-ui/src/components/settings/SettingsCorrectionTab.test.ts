import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import { createTestSettingsContext } from '../../test/settings-context'
import SettingsCorrectionTab from './SettingsCorrectionTab.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const providerState = reactive({
  provider: 'global-shortcut',
  canConfigure: false,
  platform: 'linux',
  actions: {},
  statuses: {},
  defaults: {},
})

vi.mock('../../stores/global-hotkeys', () => ({
  useGlobalHotkeysStore: () => ({ providerState, suspendHotkeys: vi.fn() }),
}))

function setup() {
  const context = createTestSettingsContext()
  const wrapper = mount(SettingsCorrectionTab, {
    global: {
      provide: context.provide,
      stubs: {
        SettingsTaskModel: {
          props: ['task'],
          template: '<div class="task-model-stub" :data-task="task" />',
        },
        HotkeyInput: {
          props: ['modelValue', 'ariaLabel'],
          emits: ['update:modelValue'],
          template: `
            <input
              class="hotkey-input-stub"
              :aria-label="ariaLabel"
              :value="modelValue"
              @input="$emit('update:modelValue', $event.target.value)"
            />
          `,
        },
      },
    },
  })
  return { context, wrapper }
}

describe('SettingsCorrectionTab.vue', () => {
  it('edits the correction prompt and shows its model', async () => {
    const { context, wrapper } = setup()
    expect(wrapper.get('.task-model-stub').attributes('data-task')).toBe(
      'correction'
    )
    await wrapper.get('textarea').setValue('Keep the tone')
    expect(context.draft.value.llm.tasks.correction.rule).toBe('Keep the tone')
  })

  it('links to the hotkeys page', async () => {
    const { context, wrapper } = setup()
    await wrapper.get('.inline-action').trigger('click')
    expect(context.navigate).toHaveBeenCalledWith('global-actions')
  })

  it('configures hotkeys for both preview and inline correction', async () => {
    const { context, wrapper } = setup()
    const inputs = wrapper.findAll('.hotkey-input-stub')
    expect(inputs).toHaveLength(2)

    await inputs[0].setValue('Ctrl+Shift+C')
    expect(context.draft.value.hotkeys.correction).toBe('Ctrl+Shift+C')

    await inputs[1].setValue('Ctrl+Alt+C')
    expect(context.draft.value.hotkeys.selectionCorrection).toBe('Ctrl+Alt+C')
  })
})
