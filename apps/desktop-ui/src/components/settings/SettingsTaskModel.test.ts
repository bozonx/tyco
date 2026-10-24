import { DEFAULT_LLM_CONFIG } from '@tyco/shared'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { modelLabel } from '../../lib/llm/llm-config'
import { createTestSettingsContext } from '../../test/settings-context'
import SettingsTaskModel from './SettingsTaskModel.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}))

function setup(modelChain: (llm: typeof DEFAULT_LLM_CONFIG) => string[]) {
  const llm = structuredClone(DEFAULT_LLM_CONFIG)
  llm.tasks.correction.modelChain = modelChain(llm)
  const context = createTestSettingsContext({ llm })
  const wrapper = mount(SettingsTaskModel, {
    props: { task: 'correction' },
    global: { provide: context.provide },
  })
  return { context, llm, wrapper }
}

describe('SettingsTaskModel.vue', () => {
  it('shows the primary model with its fallback count', () => {
    const { llm, wrapper } = setup(({ models }) => [models[0].id, models[1].id])
    expect(wrapper.text()).toContain(modelLabel(llm.models[0]))
    expect(wrapper.text()).toContain('settings.taskModelFallbacks:{"count":1}')
  })

  it('says when no model is assigned', () => {
    const { wrapper } = setup(() => [])
    expect(wrapper.text()).toContain('settings.taskModelNone')
    expect(wrapper.text()).not.toContain('settings.taskModelFallbacks')
  })

  it('opens the connections and models page to change it', async () => {
    const { context, wrapper } = setup(() => [])
    await wrapper.get('.inline-action').trigger('click')
    expect(context.navigate).toHaveBeenCalledWith('llm')
  })
})
