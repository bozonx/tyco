import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
            'screenshot',
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
      desktop = await loadFakeDesktop({ activation: { screenshot } })
      const wrapper = mountView({ inputMode, profileId: 'profile-1' })
      expect(
        wrapper.findComponent({ name: 'QuickAiRequestMenu' }).props()
      ).toEqual({
        text: 'Selected text',
        shortcutsDisabled: true,
        inputMode,
        profileId: 'profile-1',
        screenshotMode: false,
        screenshot: undefined,
      })
      wrapper.unmount()
    }
  )

  it.each(['text', 'voice'] as const)(
    'passes the activation screenshot instead of the selection in %s mode',
    async (inputMode) => {
      desktop = await loadFakeDesktop({ activation: { screenshot } })
      const wrapper = mountView({ inputMode, screenshotMode: true })
      expect(
        wrapper.findComponent({ name: 'QuickAiRequestMenu' }).props()
      ).toMatchObject({ text: '', inputMode, screenshotMode: true, screenshot })
      wrapper.unmount()
    }
  )
})
