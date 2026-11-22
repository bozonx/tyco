import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { CORE_CATALOG } from '../../lib/chat-tools/tool-catalog-entries'
import SettingsProfileToolsSection from './SettingsProfileToolsSection.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const web = CORE_CATALOG.find((entry) => entry.source.id === 'web')!
const plugin = {
  source: { kind: 'plugin' as const, id: 'notes' },
  label: 'Notes',
  icon: 'mdi:puzzle-outline',
  capabilities: ['notes'],
  tools: [
    {
      source: { kind: 'plugin' as const, id: 'notes' },
      name: 'append',
      label: 'Append',
      risk: 'external' as const,
    },
  ],
}

describe('SettingsProfileToolsSection', () => {
  it('shows the tools of a source that is on by default', () => {
    const wrapper = mount(SettingsProfileToolsSection, {
      props: { sources: [web], tools: undefined, catalog: undefined },
    })
    expect(wrapper.text()).toContain('chatTools.web.group')
    expect(wrapper.find('[data-tool="web_search"]').exists()).toBe(true)
    expect(wrapper.find('[data-tool="web_fetch"]').exists()).toBe(true)
  })

  it('switches a source off, keeping only the difference', async () => {
    const wrapper = mount(SettingsProfileToolsSection, {
      props: { sources: [web], tools: undefined, catalog: undefined },
    })
    await wrapper.get('input[type="checkbox"]').setValue(false)
    expect(wrapper.emitted('update')?.[0]).toEqual([
      {
        sources: { 'core:web': { isEnabled: false } },
        tools: {},
        commandIds: [],
      },
    ])
  })

  it('hides the tools of a source that is off', () => {
    const wrapper = mount(SettingsProfileToolsSection, {
      props: {
        sources: [web],
        tools: {
          sources: { 'core:web': { isEnabled: false } },
          tools: {},
          commandIds: [],
        },
        catalog: undefined,
      },
    })
    expect(wrapper.find('[data-tool="web_search"]').exists()).toBe(false)
  })

  it('shows a plugin off everywhere as such, and its capabilities', () => {
    const off = mount(SettingsProfileToolsSection, {
      props: {
        sources: [plugin],
        tools: undefined,
        catalog: { sources: { 'plugin:notes': { isEnabled: false } } },
      },
    })
    expect(off.text()).toContain('toolPermissions.sourceOffEverywhere')
    expect(off.find('[data-tool="append"]').exists()).toBe(false)

    const on = mount(SettingsProfileToolsSection, {
      props: { sources: [plugin], tools: undefined, catalog: undefined },
    })
    expect(on.text()).toContain('toolPermissions.pluginCapabilities')
    expect(on.text()).toContain('toolPermissions.riskExternal')
  })
})
