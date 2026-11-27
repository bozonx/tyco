import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useActionMenuStore } from '../stores/action-menu'
import { useAiProfilesStore } from '../stores/ai-profiles'
import { loadFakeDesktop, type TestDesktop } from '../test/install-fake-desktop'
import QuickAiRequestView from './QuickAiRequestView.vue'

vi.mock('../composables/use-selection-action-context', () => ({
  useSelectionActionContext: () => ({
    text: 'Selected text',
    shortcutsDisabled: true,
  }),
}))

const screenshot = {
  id: 'shot-1',
  mediaType: 'image/webp' as const,
  width: 1920,
  height: 1080,
  size: 1000,
}

let desktop: TestDesktop

const mountView = (props: Record<string, unknown>) =>
  mount(QuickAiRequestView, {
    props,
    global: {
      plugins: [desktop.pinia],
      stubs: {
        ContentPadding: { template: '<div><slot /></div>' },
        QuickAiRequestMenu: {
          name: 'QuickAiRequestMenu',
          props: [
            'text',
            'shortcutsDisabled',
            'inputMode',
            'profileId',
            'screenshotMode',
            'screenshots',
          ],
          template: '<div />',
        },
      },
    },
  })

describe('QuickAiRequestView', () => {
  afterEach(() => desktop.dispose())

  it.each(['text', 'voice'] as const)(
    'passes selection and %s input mode to the request menu',
    async (inputMode) => {
      desktop = await loadFakeDesktop({
        activation: { screenshots: [screenshot] },
      })
      const wrapper = mountView({ inputMode, profileId: 'profile-1' })
      expect(
        wrapper.findComponent({ name: 'QuickAiRequestMenu' }).props()
      ).toEqual({
        text: 'Selected text',
        shortcutsDisabled: true,
        inputMode,
        profileId: 'profile-1',
        screenshotMode: false,
        screenshots: undefined,
      })
      wrapper.unmount()
    }
  )

  it.each(['text', 'voice'] as const)(
    'passes the activation screenshot instead of the selection in %s mode',
    async (inputMode) => {
      desktop = await loadFakeDesktop({
        activation: { screenshots: [screenshot] },
      })
      const wrapper = mountView({ inputMode, screenshotMode: true })
      expect(
        wrapper.findComponent({ name: 'QuickAiRequestMenu' }).props()
      ).toMatchObject({
        text: '',
        inputMode,
        screenshotMode: true,
        screenshots: [screenshot],
        profileId: null,
      })
      wrapper.unmount()
    }
  )

  it('does not carry a cancelled profile capture into the next screenshot', async () => {
    desktop = await loadFakeDesktop({
      activation: { screenshots: [screenshot], screenshotProfileId: 'writer' },
    })
    const profileRequest = mountView({ screenshotMode: true })
    expect(
      profileRequest
        .findComponent({ name: 'QuickAiRequestMenu' })
        .props('profileId')
    ).toBe('writer')
    profileRequest.unmount()

    desktop.setState({
      activationId: 2,
      mode: 'selectionActions',
      screenshotProfileId: undefined,
    })
    desktop.backend.handle('list_ai_profiles', () => [
      {
        id: 'writer',
        name: 'Writer',
        memoryMode: 'auto',
        temperature: 0.3,
        maxOutputTokens: 500,
        projectPermissions: {},
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    await useAiProfilesStore().loadAll()

    // A cancelled native capture does not publish a snapshot.
    const action = useActionMenuStore().resolveActionItem({
      type: 'profile',
      profileId: 'writer',
      action: 'screenshotQuickAiRequest',
    })
    expect(action).toBeDefined()
    await action?.action('')
    expect(desktop.backend.callsOf('activate_mode')).toContainEqual({
      mode: 'screenshotQuickAiRequest',
      profileId: 'writer',
    })

    // The next capture can come from a native hotkey, bypassing the menu.
    desktop.setState({
      activationId: 3,
      mode: 'screenshotQuickAiRequest',
      screenshots: [screenshot],
    })
    const plainRequest = mountView({ screenshotMode: true })
    expect(
      plainRequest.findComponent({ name: 'QuickAiRequestMenu' }).props()
    ).toMatchObject({ profileId: null, screenshots: [screenshot] })
  })
})
