import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, ref } from 'vue'

import { useDismissibleLayer } from './use-dismissible-layer'

function mountLayer() {
  const dismiss = vi.fn()
  const open = ref(true)
  const wrapper = mount(
    defineComponent({
      setup() {
        const element = ref<HTMLElement | null>(null)
        useDismissibleLayer({
          isOpen: () => open.value,
          elements: () => [element.value],
          dismiss: () => {
            dismiss()
            open.value = false
          },
        })
        return { element }
      },
      template: '<div ref="element"><button>Inside</button></div>',
    }),
    { attachTo: document.body }
  )
  return { wrapper, dismiss }
}

describe('dismissible layers', () => {
  it('dismisses only the top layer on Escape and removes closed layers', () => {
    const outer = mountLayer()
    const inner = mountLayer()
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    )
    expect(inner.dismiss).toHaveBeenCalledOnce()
    expect(outer.dismiss).not.toHaveBeenCalled()
    document.body.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Escape', bubbles: true })
    )
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    )
    expect(outer.dismiss).toHaveBeenCalledOnce()
  })
  it('ignores internal clicks, dismisses on outside click and cleans up on unmount', () => {
    const layer = mountLayer()
    layer.wrapper.get('button').element.click()
    expect(layer.dismiss).not.toHaveBeenCalled()
    document.body.click()
    expect(layer.dismiss).toHaveBeenCalledOnce()
    const removed = mountLayer()
    removed.wrapper.unmount()
    document.body.click()
    expect(removed.dismiss).not.toHaveBeenCalled()
  })
})
