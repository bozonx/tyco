import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMenuModalsStore } from '../../stores/menuModals'
import InProgressMessage from './InProgressMessage.vue'

vi.mock('../../composables/useI18n', () => ({
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
    const cancelBtn = wrapper.find('button')
    expect(cancelBtn.exists()).toBe(true)
    expect(cancelBtn.text()).toContain('common.cancel')
  })

  it('invokes onCancel callback on button click', async () => {
    const onCancel = vi.fn()
    const wrapper = mount(InProgressMessage, { props: { onCancel } })

    await wrapper.find('button').trigger('click')
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('falls back to menuModalsStore.cancelPending if no onCancel prop', async () => {
    const menuModalsStore = useMenuModalsStore()
    const cancelSpy = vi.spyOn(menuModalsStore, 'cancelPending')

    const wrapper = mount(InProgressMessage)
    await wrapper.find('button').trigger('click')

    expect(cancelSpy).toHaveBeenCalledOnce()
  })

  it('triggers cancel on Escape key', async () => {
    const onCancel = vi.fn()
    mount(InProgressMessage, { props: { onCancel } })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
