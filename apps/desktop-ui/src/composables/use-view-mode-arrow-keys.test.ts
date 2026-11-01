import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import { useViewModeArrowKeys } from './use-view-mode-arrow-keys'

function mountWithArrows() {
  const step = vi.fn()
  const wrapper = mount(
    defineComponent({
      setup() {
        useViewModeArrowKeys(step)
        return () => h('input')
      },
    }),
    { attachTo: document.body }
  )
  return { step, wrapper }
}

const press = (init: KeyboardEventInit, target: EventTarget = window) => {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  })
  target.dispatchEvent(event)
  return event
}

describe('useViewModeArrowKeys', () => {
  it('steps back and forth with the arrows', () => {
    const { step, wrapper } = mountWithArrows()
    expect(press({ key: 'ArrowRight' }).defaultPrevented).toBe(true)
    press({ key: 'ArrowLeft' })
    expect(step.mock.calls).toEqual([[1], [-1]])
    wrapper.unmount()
  })

  it('ignores modified arrows, a text field and other keys', () => {
    const { step, wrapper } = mountWithArrows()
    press({ key: 'ArrowRight', ctrlKey: true })
    press({ key: 'ArrowRight', shiftKey: true })
    press({ key: 'ArrowDown' })
    press({ key: 'd', ctrlKey: true })
    press({ key: 'ArrowRight' }, wrapper.find('input').element)
    expect(step).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('stops listening once unmounted', () => {
    const { step, wrapper } = mountWithArrows()
    wrapper.unmount()
    press({ key: 'ArrowRight' })
    expect(step).not.toHaveBeenCalled()
  })
})
