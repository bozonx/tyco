import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMenuModalsStore } from '../../stores/menu-modals'
import InProgressMessage from './InProgressMessage.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('InProgressMessage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders spinner and cancel button', () => {
    const wrapper = mount(InProgressMessage, { props: { label: 'Working...' } })

    expect(wrapper.find('.loading-spinner').exists()).toBe(true)
    expect(wrapper.text()).toContain('Working...')
    const cancelBtn = wrapper.find('.in-progress-cancel-btn')
    expect(cancelBtn.exists()).toBe(true)
    expect(cancelBtn.text()).toContain('common.cancel')
  })

  it('renders specific text for correction, transformation, styling, and ai', () => {
    const correctionWrapper = mount(InProgressMessage, {
      props: { correction: true },
    })
    expect(correctionWrapper.text()).toContain('menu.correction')

    const transformationWrapper = mount(InProgressMessage, {
      props: { transformation: true },
    })
    expect(transformationWrapper.text()).toContain('menu.transformation')

    const stylingWrapper = mount(InProgressMessage, {
      props: { styling: true },
    })
    expect(stylingWrapper.text()).toContain('menu.styling')

    const aiWrapper = mount(InProgressMessage, { props: { ai: true } })
    expect(aiWrapper.text()).toContain('menu.aiRequest')

    const defaultWrapper = mount(InProgressMessage)
    expect(defaultWrapper.text()).toContain('common.inProgress')
  })

  it('invokes onCancel callback on button click', async () => {
    const onCancel = vi.fn()
    const wrapper = mount(InProgressMessage, { props: { onCancel } })

    await wrapper.find('.in-progress-cancel-btn').trigger('click')
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('falls back to menuModalsStore.cancelPending if no onCancel prop', async () => {
    const menuModalsStore = useMenuModalsStore()
    const cancelSpy = vi.spyOn(menuModalsStore, 'cancelPending')

    const wrapper = mount(InProgressMessage)
    await wrapper.find('.in-progress-cancel-btn').trigger('click')

    expect(cancelSpy).toHaveBeenCalledOnce()
  })

  it('triggers cancel on Escape key when no intent is buffered', async () => {
    const onCancel = vi.fn()
    mount(InProgressMessage, { props: { onCancel } })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('buffers insert on Space or Enter key, and clears intent on Escape without cancelling', async () => {
    const onCancel = vi.fn()
    const menuModalsStore = useMenuModalsStore()
    const wrapper = mount(InProgressMessage, { props: { onCancel } })

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))
    expect(menuModalsStore.bufferedIntent).toBe('insert')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.buffered-intent-badge').exists()).toBe(true)
    expect(wrapper.text()).toContain('menu.willInsertOnFinish')

    // Escape clears the buffered intent, doesn't cancel
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(menuModalsStore.bufferedIntent).toBeNull()
    expect(onCancel).not.toHaveBeenCalled()

    // Second Escape cancels
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('buffers copy on C key, and allows changing to insert', async () => {
    const menuModalsStore = useMenuModalsStore()
    const wrapper = mount(InProgressMessage)

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC' }))
    expect(menuModalsStore.bufferedIntent).toBe('copy')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('menu.willCopyOnFinish')

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }))
    expect(menuModalsStore.bufferedIntent).toBe('insert')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('menu.willInsertOnFinish')
  })
})
