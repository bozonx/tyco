import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import QuickAiRequestView from './QuickAiRequestView.vue'

vi.mock('../composables/use-selection-action-context', () => ({
  useSelectionActionContext: () => ({
    text: 'Selected text',
    shortcutsDisabled: true,
  }),
}))

describe('QuickAiRequestView', () => {
  it.each(['text', 'voice'] as const)(
    'passes selection and %s input mode to the request menu',
    (inputMode) => {
      const wrapper = mount(QuickAiRequestView, {
        props: { inputMode, profileId: 'profile-1' },
        global: {
          stubs: {
            ContentPadding: { template: '<div><slot /></div>' },
            QuickAiRequestMenu: {
              name: 'QuickAiRequestMenu',
              props: ['text', 'shortcutsDisabled', 'inputMode', 'profileId'],
              template: '<div />',
            },
          },
        },
      })
      expect(
        wrapper.findComponent({ name: 'QuickAiRequestMenu' }).props()
      ).toEqual({
        text: 'Selected text',
        shortcutsDisabled: true,
        inputMode,
        profileId: 'profile-1',
      })
      wrapper.unmount()
    }
  )
})
