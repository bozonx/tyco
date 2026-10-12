import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SplitPanePreview from './SplitPanePreview.vue'

describe('split preview scrolling', () => {
  it('synchronizes the editable textarea itself in both directions', async () => {
    const callbacks: FrameRequestCallback[] = []
    const raf = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        callbacks.push(callback)
        return callbacks.length
      })
    const wrapper = mount(SplitPanePreview, {
      props: { leftTitle: 'Source', rightTitle: 'Result', flushRight: true },
      slots: { left: 'Source text', right: '<textarea>Result text</textarea>' },
    })
    const panes = wrapper.findAll('.column-body')
    const textarea = wrapper.get('textarea')
    panes[0].element.scrollTop = 70
    await panes[0].trigger('scroll')
    expect(textarea.element.scrollTop).toBe(70)
    callbacks.shift()!(0)
    textarea.element.scrollTop = 120
    await textarea.trigger('scroll')
    expect(panes[0].element.scrollTop).toBe(120)
    callbacks.shift()!(0)
    wrapper.unmount()
    raf.mockRestore()
  })
})
