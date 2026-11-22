import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { createTestSettingsContext } from '../../test/settings-context'
import SettingsDialogTab from './SettingsDialogTab.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('SettingsDialogTab.vue', () => {
  it('renders only the main switch when dialog mode is disabled', () => {
    const context = createTestSettingsContext()
    context.draft.value.dialog = {
      ...context.draft.value.dialog,
      isEnabled: false,
    }
    const wrapper = mount(SettingsDialogTab, {
      global: {
        provide: context.provide,
        stubs: {
          FieldRow: {
            props: ['label', 'info'],
            template:
              '<div class="row" :data-label="label" :data-info="info"><slot /></div>',
          },
        },
      },
    })

    const rows = wrapper.findAll('.row')
    expect(rows).toHaveLength(1)
    expect(rows[0].attributes('data-label')).toBe('settings.dialogEnabled')
    expect(rows[0].attributes('data-info')).toBe('settings.dialogEnabledInfo')
    expect(wrapper.findComponent({ name: 'SettingsTaskModel' }).exists()).toBe(
      false
    )
  })

  it('renders translation and recording sections when dialog mode is enabled', async () => {
    const context = createTestSettingsContext()
    context.draft.value.dialog = {
      ...context.draft.value.dialog,
      isEnabled: true,
      isRecordingMixedDown: false,
      isRecordingProcessed: true,
    }
    const wrapper = mount(SettingsDialogTab, {
      global: {
        provide: context.provide,
        stubs: {
          FieldRow: {
            props: ['label', 'info'],
            template:
              '<div class="row" :data-label="label" :data-info="info"><slot /></div>',
          },
          SettingsTaskModel: {
            props: ['task', 'info'],
            template:
              '<div class="task-model" :data-task="task" :data-info="info"></div>',
          },
        },
      },
    })

    const sections = wrapper.findAllComponents({ name: 'SettingsSection' })
    expect(sections).toHaveLength(3)
    expect(sections[1].props('title')).toBe('settings.dialogTranslationSection')
    expect(sections[2].props('title')).toBe('settings.dialogRecordingSection')

    const taskModel = wrapper.find('.task-model')
    expect(taskModel.attributes('data-task')).toBe('dialogTranslation')
    expect(taskModel.attributes('data-info')).toBe(
      'settings.dialogTranslationModelInfo'
    )

    const textarea = wrapper.get('textarea')
    await textarea.setValue('Speak naturally')
    expect(context.draft.value.llm.tasks.dialogTranslation.rule).toBe(
      'Speak naturally'
    )

    const switches = wrapper.findAll('input[type="checkbox"]')
    // switch 0: isEnabled, switch 1: isRecordingMixedDown, switch 2: isRecordingProcessed
    expect(switches).toHaveLength(3)
    await switches[1].setValue(true)
    expect(context.draft.value.dialog.isRecordingMixedDown).toBe(true)

    await switches[2].setValue(false)
    expect(context.draft.value.dialog.isRecordingProcessed).toBe(false)
  })
})
