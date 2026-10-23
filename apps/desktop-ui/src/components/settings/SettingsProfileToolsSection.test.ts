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
const typed = { stepCountText: '', stepCountError: false }

describe('SettingsProfileToolsSection', () => {
  it('switches a group on with its default access', async () => {
    const wrapper = mount(SettingsProfileToolsSection, {
      props: { groups: [web], tools: undefined, ...typed },
    })

    expect(wrapper.text()).toContain('web.label')
    await wrapper.get('input[type="checkbox"]').setValue(true)

    expect(wrapper.emitted('update')?.[0]).toEqual([
      { groups: { web: { isEnabled: true, access: 'allow' } } },
    ])
  })

  it('shows the step limit and group details only for a group that is on', async () => {
    const wrapper = mount(SettingsProfileToolsSection, {
      props: { groups: [web], tools: { groups: {} }, ...typed },
      slots: { group: '<p class="details">details</p>' },
    })
    expect(wrapper.find('input[type="number"]').exists()).toBe(false)
    expect(wrapper.find('.details').exists()).toBe(false)

    await wrapper.setProps({
      tools: { groups: { web: { isEnabled: true, access: 'ask' } } },
    })
    expect(wrapper.find('.details').exists()).toBe(true)
    await wrapper.get('input[type="number"]').setValue('12')
    expect(wrapper.emitted('changeStepCount')?.at(-1)).toEqual(['12'])
  })

  it('shows the error of an invalid step limit', () => {
    const wrapper = mount(SettingsProfileToolsSection, {
      props: {
        groups: [web],
        tools: { groups: { web: { isEnabled: true, access: 'allow' } } },
        stepCountText: '99',
        stepCountError: true,
      },
    })
    expect(wrapper.text()).toContain('settings.profileToolStepsInvalid')
  })
})
