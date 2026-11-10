import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ImageViewerDialog from './ImageViewerDialog.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    }),
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open')
    }),
  })
})

function mountViewer(props: { open: boolean; src: string; alt?: string }) {
  return mount(ImageViewerDialog, { props })
}

describe('ImageViewerDialog', () => {
  it('opens fullscreen, places close button and closes on button click', async () => {
    const wrapper = mountViewer({
      open: true,
      src: 'blob:test',
      alt: 'Screenshot',
    })
    await nextTick()

    const dialog = document.querySelector('dialog')!
    expect(dialog.classList.contains('app-dialog--full')).toBe(true)
    expect(dialog.classList.contains('image-viewer-dialog')).toBe(true)

    const img = document.body.querySelector('img')!
    expect(img.getAttribute('src')).toBe('blob:test')
    expect(img.getAttribute('draggable')).toBe('false')

    const closeBtn = document.body.querySelector<HTMLButtonElement>(
      '.image-viewer-close'
    )!
    expect(closeBtn.getAttribute('aria-label')).toBe('chat.closeImage')
    closeBtn.click()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('zooms on wheel and pans on pointer drag without closing', async () => {
    const wrapper = mountViewer({ open: true, src: 'blob:test' })
    await nextTick()

    const stage = document.body.querySelector<HTMLElement>(
      '.image-viewer-stage'
    )!
    const img =
      document.body.querySelector<HTMLImageElement>('.image-viewer-img')!

    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
      right: 1000,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    stage.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -120,
        clientX: 500,
        clientY: 400,
        cancelable: true,
      })
    )
    await nextTick()
    expect(img.style.transform).not.toContain('scale(1)')

    img.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        clientX: 500,
        clientY: 400,
        bubbles: true,
      })
    )
    stage.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 1,
        clientX: 560,
        clientY: 430,
        bubbles: true,
      })
    )
    await nextTick()
    expect(stage.classList.contains('is-dragging')).toBe(true)
    expect(img.style.transform).toContain('translate3d(60px, 30px, 0)')

    stage.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 1,
        clientX: 560,
        clientY: 430,
        bubbles: true,
      })
    )
    await nextTick()
    expect(stage.classList.contains('is-dragging')).toBe(false)
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('closes when clicking empty backdrop outside the image without dragging', async () => {
    const wrapper = mountViewer({ open: true, src: 'blob:test' })
    await nextTick()

    const stage = document.body.querySelector<HTMLElement>(
      '.image-viewer-stage'
    )!
    stage.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 2,
        clientX: 20,
        clientY: 20,
        bubbles: true,
      })
    )
    stage.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 2,
        clientX: 20,
        clientY: 20,
        bubbles: true,
      })
    )
    await nextTick()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
