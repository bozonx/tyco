import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import CustomTransformationView from './CustomTransformationView.vue'

vi.mock('../composables/use-selection-action-context', () => ({
  useSelectionActionContext: () => ({
    text: 'test text',
    shortcutsDisabled: false,
  }),
}))

describe('CustomTransformationView.vue', () => {
  it('renders CustomTransformationMenu inside ContentPadding with selection context', () => {
    const wrapper = mount(CustomTransformationView, {
      global: {
        stubs: {
          ContentPadding: {
            template: '<div class="content-padding"><slot /></div>',
          },
          CustomTransformationMenu: {
            props: ['text', 'shortcutsDisabled'],
            template:
              '<div class="custom-transformation-menu" :data-text="text">CustomTransformationMenu</div>',
          },
        },
      },
    })

    const menu = wrapper.find('.custom-transformation-menu')
    expect(menu.exists()).toBe(true)
    expect(menu.attributes('data-text')).toBe('test text')
  })
})
