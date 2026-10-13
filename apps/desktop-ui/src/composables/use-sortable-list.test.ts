import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useSortableList } from './use-sortable-list'

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function pointer(
  type: string,
  y: number,
  target: EventTarget = window,
  id = 1,
  x = 20
) {
  const event = new MouseEvent(type, { clientY: y, clientX: x, bubbles: true })
  Object.defineProperty(event, 'pointerId', { value: id })
  target.dispatchEvent(event)
}

function setup(mode: 'sort' | 'swap' = 'sort') {
  const keys = ref(['a', 'b', 'c'])
  const move = vi.fn()
  let sortable!: ReturnType<typeof useSortableList>
  const wrapper = mount(
    defineComponent({
      setup() {
        const container = ref<HTMLElement | null>(null)
        sortable = useSortableList(container, move, {
          mode,
          getItemKeys: () => keys.value,
        })
        return () =>
          h(
            'div',
            { ref: container },
            keys.value.map((key, index) =>
              h('div', { key, 'data-sortable-item': '' }, [
                h(
                  'button',
                  {
                    onPointerdown: (event: PointerEvent) =>
                      sortable.startDrag(index, event),
                  },
                  key
                ),
              ])
            )
          )
      },
    }),
    { attachTo: document.body }
  )
  wrappers.push(wrapper)
  const cards = wrapper.findAll('[data-sortable-item]')
  cards.forEach(({ element }, index) =>
    vi
      .spyOn(element, 'getBoundingClientRect')
      .mockReturnValue({
        top: index * 48,
        bottom: index * 48 + 40,
        height: 40,
        left: 0,
        right: 100,
      } as DOMRect)
  )
  return {
    wrapper,
    keys,
    move,
    sortable,
    cards,
    handle: wrapper.find('button').element,
  }
}

describe('useSortableList', () => {
  it('waits for a movement threshold and commits only the final pointer position', () => {
    const { handle, move, sortable } = setup()
    pointer('pointerdown', 10, handle)
    pointer('pointermove', 12)
    expect(sortable.isSorting.value).toBe(false)
    pointer('pointerup', 110)
    expect(move).toHaveBeenCalledWith(0, 2)
    expect(document.body.classList.contains('is-sorting')).toBe(false)
  })

  it.each([
    'pointercancel',
    'lostpointercapture',
    'blur',
    'resize',
    'escape',
    'unmount',
  ])('cancels on %s and removes the global sorting state', (reason) => {
    const { handle, wrapper, move } = setup()
    pointer('pointerdown', 10, handle)
    pointer('pointermove', 110)
    expect(document.body.classList.contains('is-sorting')).toBe(true)
    if (reason === 'escape')
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    else if (reason === 'unmount') wrapper.unmount()
    else if (reason === 'lostpointercapture') pointer(reason, 110, handle)
    else
      window.dispatchEvent(
        reason === 'pointercancel'
          ? Object.assign(new Event(reason), { pointerId: 1 })
          : new Event(reason)
      )
    pointer('pointerup', 110)
    expect(move).not.toHaveBeenCalled()
    expect(document.body.classList.contains('is-sorting')).toBe(false)
  })

  it('ignores another pointer and a click without movement', () => {
    const { handle, move } = setup()
    pointer('pointerdown', 10, handle)
    pointer('pointermove', 110, window, 2)
    pointer('pointerup', 110, window, 2)
    pointer('pointerup', 10)
    expect(move).not.toHaveBeenCalled()
  })

  it('cancels synchronously when item identities change', async () => {
    const { keys, handle, move } = setup()
    pointer('pointerdown', 10, handle)
    pointer('pointermove', 110)
    keys.value = ['b', 'a', 'c']
    await nextTick()
    pointer('pointerup', 110)
    expect(move).not.toHaveBeenCalled()
  })

  it('cancels when a card changes height', () => {
    const { cards, handle, move } = setup()
    pointer('pointerdown', 10, handle)
    vi.mocked(cards[1].element.getBoundingClientRect).mockReturnValue({
      top: 48,
      height: 80,
    } as DOMRect)
    pointer('pointerup', 110)
    expect(move).not.toHaveBeenCalled()
  })

  it('targets fixed slots without shifting neighbours and rejects drops outside them', () => {
    const { handle, move, sortable } = setup('swap')
    pointer('pointerdown', 10, handle)
    pointer('pointermove', 110)
    expect(sortable.targetIndex.value).toBe(2)
    expect(sortable.itemOffset(1)).toBe(0)
    pointer('pointerup', 110, window, 1, 200)
    expect(move).not.toHaveBeenCalled()
    pointer('pointerdown', 10, handle)
    pointer('pointerup', 110)
    expect(move).toHaveBeenCalledWith(0, 2)
  })

  it('allows only one session across lists', () => {
    const first = setup()
    const second = setup()
    pointer('pointerdown', 10, first.handle)
    pointer('pointermove', 110)
    pointer('pointerdown', 10, second.handle, 2)
    pointer('pointerup', 110)
    expect(first.move).not.toHaveBeenCalled()
    pointer('pointerup', 110, window, 2)
    expect(second.move).toHaveBeenCalledWith(0, 2)
  })

  it('scrolls at a time-based speed and falls back to an outer scroll container', () => {
    const frames = new Map<number, FrameRequestCallback>()
    let frameId = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback)
      return frameId
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    const { wrapper, handle, move } = setup()
    const inner = wrapper.element as HTMLElement
    const outer = document.createElement('div')
    inner.parentElement!.append(outer)
    outer.append(inner)
    for (const element of [inner, outer]) {
      element.style.overflowY = 'auto'
      Object.defineProperty(element, 'scrollHeight', { value: 400 })
      Object.defineProperty(element, 'clientHeight', { value: 100 })
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
        top: 0,
        bottom: 100,
        left: 0,
        right: 100,
      } as DOMRect)
    }
    // The inner scroller has reached its end and cannot move further.
    Object.defineProperty(inner, 'scrollTop', { get: () => 300, set: () => {} })
    pointer('pointerdown', 10, handle)
    pointer('pointermove', 99)
    const tick = (time: number) => {
      const entry = [...frames.entries()][0]
      frames.delete(entry[0])
      entry[1](time)
    }
    tick(0)
    tick(10)
    expect(outer.scrollTop).toBeCloseTo(9.36)
    tick(30)
    expect(outer.scrollTop).toBeCloseTo(28.08)
    pointer('pointercancel', 99)
    expect(frames.size).toBe(0)
    expect(move).not.toHaveBeenCalled()
    outer.remove()
  })
})
