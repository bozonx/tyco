import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import StylingView from './StylingView.vue'

vi.mock('../composables/use-selection-action-context', () => ({
  useSelectionActionContext: () => ({
    text: 'test text',
    shortcutsDisabled: false,
  }),
}))

describe('StylingView.vue', () => {
  it('renders StylingMenu inside ContentPadding with selection context', () => {
    const wrapper = mount(StylingView, {
      global: {
        stubs: {
          ContentPadding: {
            template: '<div class="content-padding"><slot /></div>',
          },
          StylingMenu: {
            props: ['text', 'shortcutsDisabled'],
            template: '<div class="styling-menu" :data-text="text">StylingMenu</div>',
          },
        },
      },
    })

    const menu = wrapper.find('.styling-menu')
    expect(menu.exists()).toBe(true)
    expect(menu.attributes('data-text')).toBe('test text')
  })
})
