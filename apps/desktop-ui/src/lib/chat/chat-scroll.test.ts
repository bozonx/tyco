import { describe, expect, it, vi } from 'vitest'
import { createChatScroll } from './chat-scroll'

function fixture() {
  const element = {
    scrollHeight: 1000.4,
    scrollTop: 0,
    clientHeight: 400,
    scrollTo: vi.fn(),
  }
  const scroll = createChatScroll({
    getElement: () => element,
    getMotion: () => 'reduce',
    afterRender: async () => {},
  })
  return { element, scroll }
}

describe('chat scrolling', () => {
  it('preserves the reading position and resumes following near the bottom', async () => {
    const { element, scroll } = fixture()
    scroll.handleScroll()
    expect(scroll.pinnedToBottom.value).toBe(false)
    expect(scroll.showScrollButton.value).toBe(true)
    scroll.handleContentResized()
    await Promise.resolve()
    expect(element.scrollTo).not.toHaveBeenCalled()
    element.scrollTop = 550
    scroll.handleScroll()
    expect(scroll.pinnedToBottom.value).toBe(true)
    expect(scroll.showScrollButton.value).toBe(false)
    scroll.handleContentResized()
    await Promise.resolve()
    expect(element.scrollTo).toHaveBeenCalledWith({
      top: 600,
      behavior: 'instant',
    })
  })

  it('respects reduced motion for an explicit scroll', async () => {
    const { element, scroll } = fixture()
    await scroll.scrollToBottom('smooth')
    expect(element.scrollTo).toHaveBeenCalledWith({
      top: 600,
      behavior: 'instant',
    })
  })

  it('does not touch a detached element after rendering finishes', async () => {
    let finish!: () => void
    const scrollTo = vi.fn()
    const scroll = createChatScroll({
      getElement: () => ({
        scrollHeight: 100,
        scrollTop: 0,
        clientHeight: 50,
        scrollTo,
      }),
      getMotion: () => undefined,
      afterRender: () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    })
    const pending = scroll.scrollToBottom()
    scroll.dispose()
    finish()
    await pending
    expect(scrollTo).not.toHaveBeenCalled()
  })
})
