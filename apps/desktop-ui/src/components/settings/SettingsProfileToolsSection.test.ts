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

  it('shows group details only for a group that is on', async () => {
    const wrapper = mount(SettingsProfileToolsSection, {
      props: { groups: [web], tools: { groups: {} } },
      slots: { group: '<p class="details">details</p>' },
    })
    expect(wrapper.find('.details').exists()).toBe(false)

    await wrapper.setProps({
      tools: { groups: { web: { isEnabled: true, access: 'ask' } } },
    })
    expect(wrapper.find('.details').exists()).toBe(true)
  })
})
