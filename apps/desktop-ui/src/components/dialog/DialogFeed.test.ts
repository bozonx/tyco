import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import type { DialogFeedItem } from '../../lib/dialog/dialog-transcript'
import { i18n } from '../../lib/i18n'
import DialogFeed from './DialogFeed.vue'

function makeTurnItem(
  id: string,
  side: 'me' | 'remote',
  text: string
): DialogFeedItem {
  return {
    type: 'turn',
    turn: {
      id,
      side,
      startMs: 1000,
      endMs: 2000,
      segments: [
        {
          id: `seg-${id}`,
          side,
          startMs: 1000,
          endMs: 2000,
          text,
          isFinal: true,
          translationState: 'idle',
        },
      ],
    },
  }
}

describe('DialogFeed.vue - Marquee Selection', () => {
  const items: DialogFeedItem[] = [
    makeTurnItem('turn-1', 'remote', 'Remote speech'),
    makeTurnItem('turn-2', 'me', 'My speech'),
  ]

  it('renders items and assigns data-turn-id to turn articles', () => {
    const wrapper = mount(DialogFeed, {
      props: { items, isBubble: true, isTranslationOnly: false },
      global: { plugins: [i18n] },
    })

    const turns = wrapper.findAll('[data-turn-id]')
    expect(turns).toHaveLength(2)
    expect(turns[0].attributes('data-turn-id')).toBe('turn-1')
    expect(turns[1].attributes('data-turn-id')).toBe('turn-2')
  })

  it('emits clear-selection on single pointer click on empty background', async () => {
    const wrapper = mount(DialogFeed, {
      props: {
        items,
        isBubble: true,
        isTranslationOnly: false,
        selectedTurnIds: ['turn-1'],
      },
      global: { plugins: [i18n] },
    })

    const feedEl = wrapper.find('.dialog-feed')
    feedEl.element.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 0,
        clientX: 10,
        clientY: 10,
        bubbles: true,
      })
    )

    window.dispatchEvent(
      new PointerEvent('pointerup', { button: 0, clientX: 10, clientY: 10 })
    )

    expect(wrapper.emitted('clear-selection')).toHaveLength(1)
  })

  it('ignores pointerdown inside turn bubble allowing native text selection', async () => {
    const wrapper = mount(DialogFeed, {
      props: {
        items,
        isBubble: true,
        isTranslationOnly: false,
        selectedTurnIds: ['turn-1'],
      },
      global: { plugins: [i18n] },
    })

    const turnEl = wrapper.find('[data-turn-id="turn-1"]')
    turnEl.element.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 0,
        clientX: 50,
        clientY: 50,
        bubbles: true,
      })
    )

    window.dispatchEvent(
      new PointerEvent('pointerup', { button: 0, clientX: 50, clientY: 50 })
    )

    // Should not clear selection or trigger marquee
    expect(wrapper.emitted('clear-selection')).toBeUndefined()
    expect(wrapper.emitted('select-turns')).toBeUndefined()
  })

  it('activates marquee drag and emits select-turns when dragging across turns', async () => {
    const wrapper = mount(DialogFeed, {
      props: {
        items,
        isBubble: true,
        isTranslationOnly: false,
        selectedTurnIds: [],
      },
      global: { plugins: [i18n] },
      attachTo: document.body,
    })

    const feedEl = wrapper.find('.dialog-feed')
    const turnEls = wrapper.findAll('[data-turn-id]')

    // Mock bounding rects
    vi.spyOn(feedEl.element, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 500,
      bottom: 500,
      width: 500,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => {},
    })

    vi.spyOn(turnEls[0].element, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 10,
      right: 200,
      bottom: 60,
      width: 190,
      height: 50,
      x: 10,
      y: 10,
      toJSON: () => {},
    })

    vi.spyOn(turnEls[1].element, 'getBoundingClientRect').mockReturnValue({
      left: 300,
      top: 70,
      right: 490,
      bottom: 120,
      width: 190,
      height: 50,
      x: 300,
      y: 70,
      toJSON: () => {},
    })

    // Start drag outside bubbles (e.g. at 0, 0)
    feedEl.element.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 0,
        clientX: 0,
        clientY: 0,
        bubbles: true,
      })
    )

    // Drag to intersect only turn-1
    window.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 150, clientY: 50 })
    )
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.dialog-marquee-rect').exists()).toBe(true)
    expect(feedEl.classes()).toContain('is-marquee-active')
    expect(wrapper.emitted('select-turns')).toBeTruthy()
    const lastEmit = wrapper.emitted('select-turns')!.slice(-1)[0]
    expect(lastEmit).toEqual([['turn-1']])

    // Drag further to intersect both turns
    window.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 400, clientY: 100 })
    )
    await wrapper.vm.$nextTick()

    const bothEmit = wrapper.emitted('select-turns')!.slice(-1)[0]
    expect(bothEmit).toEqual([['turn-1', 'turn-2']])

    // End drag
    window.dispatchEvent(
      new PointerEvent('pointerup', { clientX: 400, clientY: 100 })
    )
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.dialog-marquee-rect').exists()).toBe(false)
    expect(feedEl.classes()).not.toContain('is-marquee-active')

    wrapper.unmount()
  })

  it('supports Shift modifier for union marquee selection', async () => {
    const wrapper = mount(DialogFeed, {
      props: {
        items,
        isBubble: true,
        isTranslationOnly: false,
        selectedTurnIds: ['turn-1'],
      },
      global: { plugins: [i18n] },
      attachTo: document.body,
    })

    const feedEl = wrapper.find('.dialog-feed')
    const turnEls = wrapper.findAll('[data-turn-id]')

    vi.spyOn(feedEl.element, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 500,
      bottom: 500,
      width: 500,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => {},
    })

    // turn-2 only
    vi.spyOn(turnEls[1].element, 'getBoundingClientRect').mockReturnValue({
      left: 200,
      top: 200,
      right: 400,
      bottom: 300,
      width: 200,
      height: 100,
      x: 200,
      y: 200,
      toJSON: () => {},
    })

    // Pointer down with Shift
    feedEl.element.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 0,
        clientX: 180,
        clientY: 180,
        shiftKey: true,
        bubbles: true,
      })
    )

    window.dispatchEvent(
      new PointerEvent('pointermove', {
        clientX: 250,
        clientY: 250,
        shiftKey: true,
      })
    )
    await wrapper.vm.$nextTick()

    // With shift: turn-1 (previously selected) + turn-2 (intersected)
    const lastEmit = wrapper.emitted('select-turns')!.slice(-1)[0]
    expect(lastEmit).toEqual([['turn-1', 'turn-2']])

    window.dispatchEvent(new PointerEvent('pointerup'))
    wrapper.unmount()
  })
})
