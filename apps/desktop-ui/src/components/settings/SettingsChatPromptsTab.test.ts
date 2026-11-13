import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  installFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import { createTestSettingsContext } from '../../test/settings-context'
import SettingsChatPromptsTab from './SettingsChatPromptsTab.vue'
import type { UserConfig } from '@tyco/shared'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('SettingsChatPromptsTab', () => {
  let desktop: TestDesktop

  beforeEach(() => {
    desktop = installFakeDesktop({}, 'main')
    desktop.backend.handle('list_ai_profiles', () => [
      { id: 'writer', name: 'Writer' } as never,
    ])
  })

  afterEach(() => {
    desktop.dispose()
  })

  const mountTab = (config: Partial<UserConfig> = {}) => {
    const context = createTestSettingsContext(config)
    const wrapper = mount(SettingsChatPromptsTab, {
      global: { plugins: [desktop.pinia], provide: context.provide },
    })
    return { context, wrapper }
  }

  it('adds a prompt of every profile and sets its profile', async () => {
    const { context, wrapper } = mountTab()
    await flushPromises()
    expect(wrapper.text()).toContain('chatPrompts.empty')

    const addButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'settings.addChatPrompt')
    await addButton!.trigger('click')

    expect(context.draft.value.chatPrompts.items).toEqual([
      { id: 'chat-prompt-1', name: '', rule: '', profileId: '' },
    ])
    const select = wrapper.get('select')
    expect(select.findAll('option').map((option) => option.text())).toEqual([
      'chatPrompts.everyProfile',
      'Writer',
    ])
    await select.setValue('1')
    expect(context.draft.value.chatPrompts.items[0]?.profileId).toBe('writer')
  })

  it('warns about a prompt whose profile is gone', async () => {
    const { wrapper } = mountTab({
      chatPrompts: {
        items: [{ id: 'a', name: 'A', rule: 'Do it', profileId: 'gone' }],
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('chatPrompts.profileMissing')
    expect(
      wrapper
        .get('select')
        .findAll('option')
        .map((option) => option.text())
    ).toContain('chatPrompts.missingProfile')
  })

  it('removes a prompt together with the actions that run it', async () => {
    const { context, wrapper } = mountTab({
      chatPrompts: {
        items: [
          { id: 'a', name: 'A', rule: 'Do it', profileId: '' },
          { id: 'b', name: 'B', rule: 'Do that', profileId: '' },
        ],
      },
      actionPages: [
        {
          inputMode: 'selection',
          slots: {
            q: { type: 'chatPrompt', promptId: 'a' },
            w: { type: 'chatPrompt', promptId: 'b' },
          },
        },
      ],
      customActionSlots: [
        { action: { type: 'chatPrompt', promptId: 'a' }, takesSelection: true },
      ],
    })
    await flushPromises()

    await wrapper
      .findAll('button')
      .find((button) => button.attributes('aria-label') === 'common.delete')!
      .trigger('click')

    const draft = context.draft.value
    expect(draft.chatPrompts.items.map((item) => item.id)).toEqual(['b'])
    expect(draft.actionPages[0]?.slots).toEqual({
      w: { type: 'chatPrompt', promptId: 'b' },
    })
    expect(draft.customActionSlots[0]?.action).toBeNull()
  })

  it('drops the prompts left empty when it closes', async () => {
    const { context, wrapper } = mountTab({
      chatPrompts: {
        items: [
          { id: 'a', name: '', rule: ' ', profileId: '' },
          { id: 'b', name: 'B', rule: '', profileId: '' },
        ],
      },
    })
    wrapper.unmount()
    expect(
      context.draft.value.chatPrompts.items.map((item) => item.id)
    ).toEqual(['b'])
  })
})
