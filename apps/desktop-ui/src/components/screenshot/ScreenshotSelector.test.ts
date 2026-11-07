import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  activationId: 1,
  imageId: 'test-image-id',
  screenX: 0,
  screenY: 0,
  width: 1920,
  height: 1080,
  scaleFactor: 1.5,
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

  it('emits cancel if image loading fails', async () => {
    mocks.getImage.mockRejectedValue(new Error('Failed to load image'))
    const wrapper = mount(ScreenshotSelector, { props: { selection } })
    await flushPromises()

    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('cancels on Escape keydown', async () => {
    mocks.getImage.mockResolvedValue(new Uint8Array([1, 2, 3]))
    const wrapper = mount(ScreenshotSelector, { props: { selection } })
    await flushPromises()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('cancels on contextmenu (right click)', async () => {
    mocks.getImage.mockResolvedValue(new Uint8Array([1, 2, 3]))
    const wrapper = mount(ScreenshotSelector, { props: { selection } })
    await flushPromises()

    await wrapper.trigger('contextmenu')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('rejects selections smaller than MIN_DRAG_PX (4px)', async () => {
    mocks.getImage.mockResolvedValue(new Uint8Array([1, 2, 3]))
    const wrapper = mount(ScreenshotSelector, { props: { selection } })
    await flushPromises()

    const root = wrapper.get('.screenshot-selector-root').element
    root.dispatchEvent(
      new PointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 10 })
    )
    root.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 12, clientY: 12 })
    ) // 2x2 px (< 4px)
    root.dispatchEvent(
      new PointerEvent('pointerup', { clientX: 12, clientY: 12 })
    )

    expect(wrapper.emitted('confirm')).toBeUndefined()
  })

  it('emits confirm with scaled crop coordinates on valid drag', async () => {
    mocks.getImage.mockResolvedValue(new Uint8Array([1, 2, 3]))
    const wrapper = mount(ScreenshotSelector, { props: { selection } })
    await flushPromises()

    const root = wrapper.get('.screenshot-selector-root').element
    root.dispatchEvent(
      new PointerEvent('pointerdown', { button: 0, clientX: 100, clientY: 100 })
    )
    root.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 300, clientY: 200 })
    )
    root.dispatchEvent(
      new PointerEvent('pointerup', { clientX: 300, clientY: 200 })
    )

    const emitted = wrapper.emitted('confirm')
    expect(emitted).toHaveLength(1)
    // scale factor is 1.5:
    // x: 100 * 1.5 = 150
    // y: 100 * 1.5 = 150
    // width: 200 * 1.5 = 300
    // height: 100 * 1.5 = 150
    expect(emitted?.[0]?.[0]).toEqual({
      x: 150,
      y: 150,
      width: 300,
      height: 150,
    })
  })

  it('handles reverse drag (drag from bottom-right to top-left)', async () => {
    mocks.getImage.mockResolvedValue(new Uint8Array([1, 2, 3]))
    const wrapper = mount(ScreenshotSelector, {
      props: { selection: { ...selection, scaleFactor: 1.0 } },
    })
    await flushPromises()

    const root = wrapper.get('.screenshot-selector-root').element
    root.dispatchEvent(
      new PointerEvent('pointerdown', { button: 0, clientX: 400, clientY: 300 })
    )
    root.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 200, clientY: 100 })
    )
    root.dispatchEvent(
      new PointerEvent('pointerup', { clientX: 200, clientY: 100 })
    )

    const emitted = wrapper.emitted('confirm')
    expect(emitted).toHaveLength(1)
    expect(emitted?.[0]?.[0]).toEqual({
      x: 200,
      y: 100,
      width: 200,
      height: 200,
    })
  })
})
