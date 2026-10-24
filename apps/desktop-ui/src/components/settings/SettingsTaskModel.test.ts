import { DEFAULT_LLM_CONFIG } from '@tyco/shared'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { modelLabel } from '../../lib/llm/llm-config'
import { createTestSettingsContext } from '../../test/settings-context'
import FieldRow from '../common/FieldRow.vue'
import SettingsTaskModel from './SettingsTaskModel.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}))

function setup(modelId: (llm: typeof DEFAULT_LLM_CONFIG) => string) {
  const llm = structuredClone(DEFAULT_LLM_CONFIG)
  llm.tasks.correction.modelId = modelId(llm)
  const context = createTestSettingsContext({ llm })
  const wrapper = mount(SettingsTaskModel, {
    props: { task: 'correction' },
    global: { provide: context.provide },
  })
  return { context, llm, wrapper }
}

describe('SettingsTaskModel.vue', () => {
  it('shows the task model', () => {
    const { llm, wrapper } = setup(({ models }) => models[1].id)
    expect(wrapper.text()).toContain(modelLabel(llm.models[1]))
    expect(wrapper.text()).not.toContain('settings.taskModelNone')
  })

  it('says when no model is assigned', () => {
    const { wrapper } = setup(() => '')
    expect(wrapper.text()).toContain('settings.taskModelNone')
  })

  it('opens the connections and models page to change it', async () => {
    const { context, wrapper } = setup(() => '')
    await wrapper.get('.inline-action').trigger('click')
    expect(context.navigate).toHaveBeenCalledWith('llm')
  })

  it('renders a flow field row so label, tooltip and model stay on one line', () => {
    const { wrapper } = setup(() => '')
    expect(wrapper.findComponent(FieldRow).props('flow')).toBe(true)
  })
})
