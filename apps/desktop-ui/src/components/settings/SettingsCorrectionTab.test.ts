import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { createTestSettingsContext } from '../../test/settings-context'
import SettingsCorrectionTab from './SettingsCorrectionTab.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
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
  it('edits the correction prompt and shows its model without a section title', async () => {
    const { context, wrapper } = setup()
    expect(wrapper.find('.settings-section-title').exists()).toBe(false)
    expect(wrapper.get('.task-model-stub').attributes('data-task')).toBe(
      'correction'
    )
    await wrapper.get('textarea').setValue('Keep the tone')
    expect(context.draft.value.llm.tasks.correction.rule).toBe('Keep the tone')
  })

  it('links to the hotkeys page from the description', async () => {
    const { context, wrapper } = setup()
    await wrapper.get('.inline-action').trigger('click')
    expect(context.navigate).toHaveBeenCalledWith('global-actions')
  })
})
