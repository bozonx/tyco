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

  it('shows the correction hotkeys without editing them', async () => {
    const { context, wrapper } = setup()
    context.draft.value.hotkeys.correction = 'Ctrl+Shift+C'
    context.draft.value.hotkeys.selectionCorrection = ''
    await wrapper.vm.$nextTick()
    expect(wrapper.find('button.hotkey-input').exists()).toBe(false)
    const displays = wrapper.findAll('.hotkey-display')
    expect(displays).toHaveLength(2)
    expect(displays[0].findAll('kbd').map((key) => key.text())).toEqual([
      'Ctrl',
      'Shift',
      'C',
    ])
    expect(displays[1].text()).toBe('settings.hotkeyNotAssigned')
  })
})
