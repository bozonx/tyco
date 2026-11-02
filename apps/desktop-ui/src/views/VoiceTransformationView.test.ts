import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import VoiceTransformationView from './VoiceTransformationView.vue'

vi.mock('../composables/use-selection-action-context', () => ({
  useSelectionActionContext: () => ({
    text: 'test text',
    shortcutsDisabled: false,
  }),
}))

describe('VoiceTransformationView.vue', () => {
  it('renders VoiceTransformationMenu inside ContentPadding with selection context', () => {
    const wrapper = mount(VoiceTransformationView, {
      global: {
        stubs: {
          ContentPadding: {
            template: '<div class="content-padding"><slot /></div>',
          },
          VoiceTransformationMenu: {
            props: ['text', 'shortcutsDisabled'],
            template:
              '<div class="voice-transformation-menu" :data-text="text">VoiceTransformationMenu</div>',
          },
        },
      },
    })

    const menu = wrapper.find('.voice-transformation-menu')
    expect(menu.exists()).toBe(true)
    expect(menu.attributes('data-text')).toBe('test text')
  })
})
