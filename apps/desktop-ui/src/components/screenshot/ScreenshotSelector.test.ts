import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import ScreenshotSelector from './ScreenshotSelector.vue'
import type { ScreenshotAreaSelection } from '@tyco/shared'

const mocks = vi.hoisted(() => ({ getImage: vi.fn() }))

vi.mock('../../lib/chat/chat-image-storage', () => ({
  getChatImage: mocks.getImage,
}))

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const selection: ScreenshotAreaSelection = {
  selectionId: 1,
  imageId: 'test-image-id',
  mediaType: 'image/png',
  screenX: 0,
  screenY: 0,
  // jsdom views are 1024 × 768, so the image is twice the view size
  width: 2048,
  height: 1536,
  scaleFactor: 1,
}

describe('ScreenshotSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    URL.createObjectURL = vi.fn(() => 'blob:screenshot-test')
    URL.revokeObjectURL = vi.fn()
  })

  it('loads image and renders image with blob URL', async () => {
    mocks.getImage.mockResolvedValue(new Uint8Array([1, 2, 3]))
    const wrapper = mount(ScreenshotSelector, { props: { selection } })
    await flushPromises()

    expect(mocks.getImage).toHaveBeenCalledWith('test-image-id')
    expect(wrapper.get('img.screenshot-selector-image').attributes('src')).toBe(
      'blob:screenshot-test'
    )
    wrapper.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:screenshot-test')
  })

  it('types the image by the media type of the selection', async () => {
    mocks.getImage.mockResolvedValue(new Uint8Array([1, 2, 3]))
    const blobs: Blob[] = []
    URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
      blobs.push(blob as Blob)
      return 'blob:screenshot-test'
    })
    const wrapper = mount(ScreenshotSelector, { props: { selection } })
    await flushPromises()

    expect(blobs[0].type).toBe('image/png')
    wrapper.unmount()
  })

  it('emits failed if image loading fails', async () => {
    mocks.getImage.mockRejectedValue(new Error('Failed to load image'))
    const wrapper = mount(ScreenshotSelector, { props: { selection } })
    await flushPromises()

    expect(wrapper.emitted('failed')).toHaveLength(1)
    expect(wrapper.emitted('cancel')).toBeUndefined()
  })

  it('cancels on Escape keydown', async () => {
    mocks.getImage.mockResolvedValue(new Uint8Array([1, 2, 3]))
    const wrapper = mount(ScreenshotSelector, { props: { selection } })
    await flushPromises()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('cancels on contextmenu (right click)', async () => {
    mocks.getImage.mockResolvedValue(new Uint8Array([1, 2, 3]))
    const wrapper = mount(ScreenshotSelector, { props: { selection } })
    await flushPromises()

    await wrapper.trigger('contextmenu')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  async function mountLoaded() {
    mocks.getImage.mockResolvedValue(new Uint8Array([1, 2, 3]))
    const wrapper = mount(ScreenshotSelector, {
      props: { selection },
      attachTo: document.body,
    })
    await flushPromises()
    return wrapper
  }

  async function pointer(
    wrapper: Awaited<ReturnType<typeof mountLoaded>>,
    type: string,
    init: PointerEventInit
  ) {
    wrapper.element.dispatchEvent(new PointerEvent(type, init))
    await nextTick()
  }

  async function drag(
    wrapper: Awaited<ReturnType<typeof mountLoaded>>,
    from: [number, number],
    to: [number, number]
  ) {
    const root = wrapper.get('.screenshot-selector-root').element
    root.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 0,
        clientX: from[0],
        clientY: from[1],
      })
    )
    root.dispatchEvent(
      new PointerEvent('pointermove', { clientX: to[0], clientY: to[1] })
    )
    root.dispatchEvent(
      new PointerEvent('pointerup', { clientX: to[0], clientY: to[1] })
    )
    await nextTick()
  }

  const pressEnter = () =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))

  const pressSpace = () =>
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', code: 'Space' })
    )

  it('ignores drags shorter than the minimum selection', async () => {
    const wrapper = await mountLoaded()
    await drag(wrapper, [10, 10], [12, 12])
    pressEnter()
    pressSpace()
    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.find('.selection-box').exists()).toBe(false)
  })

  it('keeps a finished drag until it is confirmed with Enter or Space', async () => {
    const wrapper = await mountLoaded()
    await drag(wrapper, [100, 100], [300, 200])
    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.get('.selection-badge').text()).toBe('400 × 200 px')

    pressEnter()
    expect(wrapper.emitted('confirm')?.[0]?.[0]).toEqual({
      x: 200,
      y: 200,
      width: 400,
      height: 200,
    })

    pressSpace()
    expect(wrapper.emitted('confirm')?.[1]?.[0]).toEqual({
      x: 200,
      y: 200,
      width: 400,
      height: 200,
    })
  })

  it('confirms with the button or a double-click', async () => {
    const wrapper = await mountLoaded()
    await drag(wrapper, [400, 300], [200, 100])
    await wrapper.get('.selection-confirm').trigger('click')
    await wrapper.trigger('dblclick')
    const emitted = wrapper.emitted('confirm')
    expect(emitted).toHaveLength(2)
    expect(emitted?.[0]?.[0]).toEqual({
      x: 400,
      y: 200,
      width: 400,
      height: 400,
    })
  })

  it('redraws the selection on a new drag', async () => {
    const wrapper = await mountLoaded()
    await drag(wrapper, [100, 100], [300, 200])
    await drag(wrapper, [0, 0], [50, 50])
    pressEnter()
    expect(wrapper.emitted('confirm')?.[0]?.[0]).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    })
  })
  it('continues from the screen edge and confirms the final position', async () => {
    const wrapper = await mountLoaded()
    await pointer(wrapper, 'pointerdown', {
      pointerId: 1,
      button: 0,
      clientX: 100,
      clientY: 100,
    })
    await pointer(wrapper, 'pointermove', {
      pointerId: 1,
      buttons: 1,
      clientX: 1200,
      clientY: 900,
    })
    expect(wrapper.get('.selection-badge').text()).toBe('1848 × 1336 px')
    await pointer(wrapper, 'pointermove', {
      pointerId: 1,
      buttons: 1,
      clientX: 800,
      clientY: 600,
    })
    await pointer(wrapper, 'pointerup', {
      pointerId: 1,
      button: 0,
      clientX: 800,
      clientY: 600,
    })
    pressEnter()
    expect(wrapper.emitted('confirm')?.[0]?.[0]).toEqual({
      x: 200,
      y: 200,
      width: 1400,
      height: 1000,
    })
  })

  it.each(['lostpointercapture', 'pointercancel'])(
    'finishes a drag on %s without using its empty coordinates',
    async (event) => {
      const wrapper = await mountLoaded()
      await pointer(wrapper, 'pointerdown', {
        pointerId: 1,
        button: 0,
        clientX: 100,
        clientY: 100,
      })
      await pointer(wrapper, 'pointermove', {
        pointerId: 1,
        buttons: 1,
        clientX: 1024,
        clientY: 768,
      })
      await pointer(wrapper, event, { pointerId: 1 })
      pressEnter()
      expect(wrapper.emitted('confirm')?.[0]?.[0]).toEqual({
        x: 200,
        y: 200,
        width: 1848,
        height: 1336,
      })
      await drag(wrapper, [10, 10], [50, 50])
      pressEnter()
      expect(wrapper.emitted('confirm')?.[1]?.[0]).toEqual({
        x: 20,
        y: 20,
        width: 80,
        height: 80,
      })
    }
  )

  it('recovers when the mouse returns after an unobserved release', async () => {
    const wrapper = await mountLoaded()
    await pointer(wrapper, 'pointerdown', {
      pointerId: 1,
      button: 0,
      clientX: 100,
      clientY: 100,
    })
    await pointer(wrapper, 'pointermove', {
      pointerId: 1,
      pointerType: 'mouse',
      buttons: 1,
      clientX: 1024,
      clientY: 768,
    })
    await pointer(wrapper, 'pointermove', {
      pointerId: 1,
      pointerType: 'mouse',
      buttons: 0,
      clientX: 500,
      clientY: 500,
    })
    pressEnter()
    expect(wrapper.emitted('confirm')?.[0]?.[0]).toEqual({
      x: 200,
      y: 200,
      width: 1848,
      height: 1336,
    })
  })

  it('ignores other pointers while dragging', async () => {
    const wrapper = await mountLoaded()
    await pointer(wrapper, 'pointerdown', {
      pointerId: 1,
      button: 0,
      clientX: 100,
      clientY: 100,
    })
    await pointer(wrapper, 'pointermove', {
      pointerId: 1,
      buttons: 1,
      clientX: 300,
      clientY: 200,
    })
    await pointer(wrapper, 'pointerdown', {
      pointerId: 2,
      button: 0,
      clientX: 0,
      clientY: 0,
    })
    await pointer(wrapper, 'pointerup', {
      pointerId: 2,
      button: 0,
      clientX: 0,
      clientY: 0,
    })
    pressEnter()
    expect(wrapper.emitted('confirm')).toBeUndefined()
    await pointer(wrapper, 'pointerup', {
      pointerId: 1,
      button: 0,
      clientX: 300,
      clientY: 200,
    })
    pressEnter()
    expect(wrapper.emitted('confirm')?.[0]?.[0]).toEqual({
      x: 200,
      y: 200,
      width: 400,
      height: 200,
    })
  })
})
