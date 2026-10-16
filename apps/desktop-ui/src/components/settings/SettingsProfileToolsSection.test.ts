import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import SettingsProfileToolsSection from './SettingsProfileToolsSection.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const web = {
  id: 'web',
  labelKey: 'web.label',
  descriptionKey: 'web.description',
  icon: 'mdi:web',
  defaultAccess: 'allow' as const,
}

describe('SettingsProfileToolsSection', () => {
  it('switches a group on with its default access', async () => {
    const wrapper = mount(SettingsProfileToolsSection, {
      props: { groups: [web], tools: undefined },
    })

    expect(wrapper.text()).toContain('web.label')
    await wrapper.get('input[type="checkbox"]').setValue(true)

    expect(wrapper.emitted('update')?.[0]).toEqual([
      { groups: { web: { isEnabled: true, access: 'allow' } } },
    ])
  })

  it('stores a valid step limit and refuses another', async () => {
    const wrapper = mount(SettingsProfileToolsSection, {
      props: { groups: [web], tools: { groups: {} } },
    })
    const steps = wrapper.get('input[type="number"]')

    await steps.setValue('12')
    expect(wrapper.emitted('update')?.at(-1)).toEqual([
      { groups: {}, maxStepCount: 12 },
    ])

    await steps.setValue('99')
    expect(wrapper.emitted('update')).toHaveLength(1)
    expect(wrapper.text()).toContain('settings.profileToolStepsInvalid')
  })
})
