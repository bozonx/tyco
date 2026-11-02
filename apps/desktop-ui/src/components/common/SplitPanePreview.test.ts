import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SplitPanePreview from './SplitPanePreview.vue'

describe('split preview scrolling', () => {
  it('synchronizes the editable textarea itself in both directions', async () => {
    vi.useFakeTimers()
    const wrapper = mount(SplitPanePreview, {
      props: { leftTitle: 'Source', rightTitle: 'Result', flushRight: true },
      slots: { left: 'Source text', right: '<textarea>Result text</textarea>' },
    })
    const panes = wrapper.findAll('.column-body')
    const textarea = wrapper.get('textarea')
    panes[0].element.scrollTop = 70
    await panes[0].trigger('scroll')
    expect(textarea.element.scrollTop).toBe(70)

    // Advance timers so active side resets for reverse direction
    vi.advanceTimersByTime(150)

    textarea.element.scrollTop = 120
    await textarea.trigger('scroll')
    expect(panes[0].element.scrollTop).toBe(120)
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('does not roll back leader pane during fast continuous scrolling', async () => {
    const wrapper = mount(SplitPanePreview, {
      props: { leftTitle: 'Source', rightTitle: 'Result' },
      slots: { left: 'Source text', right: 'Result text' },
    })
    const panes = wrapper.findAll('.column-body')
    // Pane 0 scrolls to 30, then 60 while it is the active side
    panes[0].element.scrollTop = 30
    await panes[0].trigger('scroll')
    expect(panes[1].element.scrollTop).toBe(30)

    panes[0].element.scrollTop = 60
    await panes[0].trigger('scroll')
    expect(panes[1].element.scrollTop).toBe(60)

    // Follower emits its delayed scroll event while leader is still active
    panes[1].element.scrollTop = 30
    await panes[1].trigger('scroll')
    // Leader must NOT be rolled back to 30; stays at 60
    expect(panes[0].element.scrollTop).toBe(60)
    wrapper.unmount()
  })

  it('scrolls the pane when wheel event is fired on the container outside body', async () => {
    const wrapper = mount(SplitPanePreview, {
      props: { leftTitle: 'Source', rightTitle: 'Result' },
      slots: { left: 'Source text', right: 'Result text' },
    })
    const panes = wrapper.findAll('.column-body')
    panes[0].element.scrollTop = 0

    const container = wrapper.find('.split-panes')
    await container.trigger('wheel', { deltaY: 50, deltaMode: 0 })
    expect(panes[0].element.scrollTop).toBe(50)
    wrapper.unmount()
  })
})
