import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import BaseDialog from './BaseDialog.vue'

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
      this.querySelector<HTMLButtonElement>('[autofocus]')?.focus()
    }),
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open')
    }),
  })
})

describe('BaseDialog', () => {
  it('opens modally, exposes its name and restores focus on closing', async () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const wrapper = mount(BaseDialog, {
      props: { open: true, labelledby: 'title', describedby: 'message' },
      attrs: { class: 'preview-dialog' },
      slots: {
        default:
          '<h3 id="title">Delete?</h3><p id="message">Confirm deletion.</p><button autofocus>Cancel</button>',
      },
    })
    await nextTick()
    const dialog = document.querySelector('dialog')!
    expect(dialog.showModal).toHaveBeenCalledOnce()
    expect(dialog.classList.contains('preview-dialog')).toBe(true)
    expect(dialog.getAttribute('aria-labelledby')).toBe('title')
    expect(dialog.getAttribute('aria-describedby')).toBe('message')
    expect(document.activeElement?.textContent).toBe('Cancel')
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }))
    expect(wrapper.emitted('close')).toHaveLength(1)
    await wrapper.setProps({ open: false })
    await nextTick()
    expect(dialog.open).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })
  it('ignores a stale opening when it closes before the render finishes', async () => {
    const wrapper = mount(BaseDialog, {
      props: { open: true, label: 'Preview' },
    })
    await wrapper.setProps({ open: false })
    await nextTick()
    expect(document.querySelector('dialog')?.open).toBe(false)
  })
})
