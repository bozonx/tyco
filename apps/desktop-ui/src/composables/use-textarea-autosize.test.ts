import { defineComponent, h, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { useTextareaAutosize } from './use-textarea-autosize'

describe('textarea autosize', () => {
  it('caps height, updates after external edits and restores native sizing when disabled', async () => {
    const Harness = defineComponent({
      props: { value: String, enabled: Boolean },
      setup(props) {
        const element = ref<HTMLTextAreaElement | null>(null)
        useTextareaAutosize(
          element,
          () => props.value,
          () => ({ enabled: props.enabled, maxHeight: 100 })
        )
        return () => h('textarea', { ref: element, value: props.value })
      },
    })
    const wrapper = mount(Harness, { props: { value: 'Short', enabled: true } })
    const element = wrapper.get('textarea').element
    Object.defineProperty(element, 'scrollHeight', {
      configurable: true,
      value: 180,
    })
    await wrapper.setProps({ value: 'Long text' })
    await flushPromises()
    expect(element.style.height).toBe('100px')
    expect(element.style.overflowY).toBe('auto')
    Object.defineProperty(element, 'scrollHeight', {
      configurable: true,
      value: 40,
    })
    await wrapper.setProps({ value: 'Short again' })
    expect(element.style.height).toBe('40px')
    expect(element.style.overflowY).toBe('hidden')
    await wrapper.setProps({ enabled: false })
    expect(element.style.height).toBe('')
    expect(element.style.overflowY).toBe('')
    wrapper.unmount()
  })
})
