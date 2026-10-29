import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import TransformationView from './TransformationView.vue'

vi.mock('../composables/use-selection-action-context', () => ({
  useSelectionActionContext: () => ({
    text: 'test text',
    shortcutsDisabled: false,
  }),
}))

describe('TransformationView.vue', () => {
  it('renders TransformationMenu inside ContentPadding with selection context', () => {
    const wrapper = mount(TransformationView, {
      global: {
        stubs: {
          ContentPadding: {
            template: '<div class="content-padding"><slot /></div>',
          },
          TransformationMenu: {
            props: ['text', 'shortcutsDisabled'],
            template:
              '<div class="transformation-menu" :data-text="text">TransformationMenu</div>',
          },
        },
      },
    })

    const menu = wrapper.find('.transformation-menu')
    expect(menu.exists()).toBe(true)
    expect(menu.attributes('data-text')).toBe('test text')
  })
})
