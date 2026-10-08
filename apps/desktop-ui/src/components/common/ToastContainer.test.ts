import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useToastStore } from '../../stores/toast'
import ToastContainer from './ToastContainer.vue'

describe('ToastContainer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders nothing when there are no toasts', () => {
    const wrapper = mount(ToastContainer, { global: { stubs: { Icon: true } } })

    expect(wrapper.findAll('.toast-card')).toHaveLength(0)
  })

  it('renders toasts with message, title, and handles remove click', async () => {
    const toastStore = useToastStore()
    toastStore.addToast('Operation finished', 'success', {
      title: 'Success Title',
      duration: 0,
    })

    const wrapper = mount(ToastContainer, { global: { stubs: { Icon: true } } })

    expect(wrapper.findAll('.toast-card')).toHaveLength(1)
    expect(wrapper.text()).toContain('Success Title')
    expect(wrapper.text()).toContain('Operation finished')

    const closeBtn = wrapper.find('button[aria-label="Close"]')
    expect(closeBtn.exists()).toBe(true)
    expect(closeBtn.attributes('tabindex')).toBe('-1')
    await closeBtn.trigger('click')

    expect(toastStore.toasts).toHaveLength(0)
  })

  it('calls pause and resume on hover events', async () => {
    const toastStore = useToastStore()
    const id = toastStore.addToast('Hover test', 'warn', { duration: 5000 })

    const wrapper = mount(ToastContainer, { global: { stubs: { Icon: true } } })

    const card = wrapper.find('.toast-card')
    await card.trigger('mouseenter')
    expect(toastStore.toasts.find((t) => t.id === id)?.isPaused).toBe(true)

    await card.trigger('mouseleave')
    expect(toastStore.toasts.find((t) => t.id === id)?.isPaused).toBe(false)
  })
})
