import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { createTestSettingsContext } from '../../test/settings-context'
import SettingsChatPromptsTab from './SettingsChatPromptsTab.vue'
import SettingsStylingTab from './SettingsStylingTab.vue'
import SettingsTransformationsTab from './SettingsTransformationsTab.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('RuleLibrary tabs', () => {
  it('renders styling tab with title and info tooltip', () => {
    const context = createTestSettingsContext()
    const wrapper = mount(SettingsStylingTab, {
      global: {
        provide: context.provide,
        stubs: { SettingsTaskModel: true, ShortcutSlots: true },
      },
    })
    const section = wrapper.findComponent({ name: 'SettingsSection' })
    expect(section.props('title')).toBe('settings.stylingTab')
    expect(section.props('info')).toBe('settings.stylingHint')
  })

  it('renders transformations tab with title and info tooltip', () => {
    const context = createTestSettingsContext()
    const wrapper = mount(SettingsTransformationsTab, {
      global: {
        provide: context.provide,
        stubs: { SettingsTaskModel: true, ShortcutSlots: true },
      },
    })
    const section = wrapper.findComponent({ name: 'SettingsSection' })
    expect(section.props('title')).toBe('settings.transformationsTab')
    expect(section.props('info')).toBe('settings.transformationsHint')
  })

  it('renders chat prompts tab with title and info tooltip', () => {
    const context = createTestSettingsContext()
    const wrapper = mount(SettingsChatPromptsTab, {
      global: {
        provide: context.provide,
        stubs: { SettingsTaskModel: true, ShortcutSlots: true },
      },
    })
    const section = wrapper.findComponent({ name: 'SettingsSection' })
    expect(section.props('title')).toBe('settings.chatPromptsTab')
    expect(section.props('info')).toBe('settings.chatPromptsHint')
    const ruleLibrary = wrapper.findComponent({ name: 'RuleLibrarySettings' })
    expect(ruleLibrary.props('idPrefix')).toMatch(/^[a-z0-9][a-z0-9._-]{0,63}$/)
  })
})
