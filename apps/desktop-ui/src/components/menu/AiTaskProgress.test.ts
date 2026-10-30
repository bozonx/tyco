import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import type { AiTaskConfig } from '@tyco/shared'
import type { TaskRunState } from '../../lib/ai-tasks/task-runner'
import AiTaskProgress from './AiTaskProgress.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('AiTaskProgress.vue', () => {
  const defaultTask: AiTaskConfig = {
    id: 'task-1',
    name: 'Summarize Text',
    prompt: 'Summarize',
    allowedTools: [],
    outputAction: 'replace',
    maxSteps: 5,
  }

  const defaultState: TaskRunState = {
    status: 'running',
    text: '',
    reasoning: '',
    toolCalls: [],
  }

  it('renders spinner, task name, and cancel button', () => {
    const wrapper = mount(AiTaskProgress, {
      props: { task: defaultTask, state: defaultState },
    })

    expect(wrapper.find('.animate-spin').exists()).toBe(true)
    expect(wrapper.text()).toContain('Summarize Text')
    const cancelBtn = wrapper.find('button')
    expect(cancelBtn.exists()).toBe(true)
    expect(cancelBtn.text()).toContain('common.cancel')
  })

  it('falls back to default title if task has no name', () => {
    const wrapper = mount(AiTaskProgress, {
      props: {
        task: { ...defaultTask, id: 'task-2', name: '' },
        state: defaultState,
      },
    })

    expect(wrapper.text()).toContain('menu.aiTask')
  })

  it('emits cancel when cancel button is clicked', async () => {
    const wrapper = mount(AiTaskProgress, {
      props: { task: defaultTask, state: defaultState },
    })

    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('emits cancel on Escape key via dismissible layer', () => {
    const wrapper = mount(AiTaskProgress, {
      props: { task: defaultTask, state: defaultState },
    })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })
})
