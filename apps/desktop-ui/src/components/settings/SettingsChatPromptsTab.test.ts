import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  installFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import { createTestSettingsContext } from '../../test/settings-context'
import SettingsChatPromptsTab from './SettingsChatPromptsTab.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('SettingsChatPromptsTab', () => {
  let desktop: TestDesktop

  beforeEach(() => {
    desktop = installFakeDesktop({}, 'main')
    desktop.backend.handle('list_ai_profiles', () => [])
  })

  afterEach(() => {
    desktop.dispose()
  })

  const mountTab = (context = createTestSettingsContext()) => ({
    context,
    wrapper: mount(SettingsChatPromptsTab, {
      global: {
        plugins: [desktop.pinia],
        provide: context.provide,
        stubs: { ShortcutSlots: true },
      },
    }),
  })

  it('adds a page with the default profile and its prompt grid', async () => {
    const { context, wrapper } = mountTab()
    expect(wrapper.text()).toContain('chatPrompts.noPages')

    const addButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'settings.addPromptPage')
    await addButton!.trigger('click')

    expect(context.draft.value.chatPrompts.pages).toEqual([
      { profileId: '', items: [], slots: {} },
    ])
    expect(
      wrapper.findComponent({ name: 'RuleLibrarySettings' }).exists()
    ).toBe(true)
  })

  it('warns about a page whose profile is gone', async () => {
    const { wrapper } = mountTab(
      createTestSettingsContext({
        chatPrompts: {
          isSentImmediately: true,
          pages: [{ profileId: 'gone', items: [], slots: {} }],
        },
      })
    )
    await flushPromises()
    expect(wrapper.text()).toContain('chatPrompts.profileMissing')
  })
})
