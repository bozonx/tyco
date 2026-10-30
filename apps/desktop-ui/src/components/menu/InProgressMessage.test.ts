import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useDesktopStore } from '../../stores/desktop'
import { useMenuModalsStore } from '../../stores/menu-modals'
import InProgressMessage from './InProgressMessage.vue'

const mocks = vi.hoisted(() => ({ toastKey: vi.fn(), isEditorPage: false }))

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../../composables/use-toast', () => ({
  default: () => ({ toastKey: mocks.toastKey, toastText: vi.fn() }),
}))

vi.mock('../../composables/use-editor-navigation', () => ({
  useEditorNavigation: () => ({ isEditorPage: () => mocks.isEditorPage }),
}))

describe('InProgressMessage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mocks.toastKey.mockReset()
    mocks.isEditorPage = false
    vi.spyOn(useDesktopStore(), 'canInsertIntoWindow', 'get').mockReturnValue(
      true
    )
  })

  it('renders spinner and cancel button', () => {
    const wrapper = mount(InProgressMessage, { props: { label: 'Working...' } })

    expect(wrapper.find('.loading-spinner').exists()).toBe(true)
    expect(wrapper.text()).toContain('Working...')
    const cancelBtn = wrapper.find('.in-progress-cancel-btn')
    expect(cancelBtn.exists()).toBe(true)
    expect(cancelBtn.text()).toContain('common.cancel')
  })

  it('renders custom cancel button label when provided', () => {
    const wrapper = mount(InProgressMessage, {
      props: { label: 'Working...', cancelLabel: 'Skip' },
    })

    const cancelBtn = wrapper.find('.in-progress-cancel-btn')
    expect(cancelBtn.exists()).toBe(true)
    expect(cancelBtn.text()).toBe('Skip')
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

  it('does not show buffered intent hints by default when allowBufferedIntent is false', () => {
    const wrapper = mount(InProgressMessage)
    expect(wrapper.find('.buffered-intent-hints').exists()).toBe(false)
  })

  it('buffers insert on Space or Enter key, and clears intent on Escape without cancelling', async () => {
    const onCancel = vi.fn()
    const menuModalsStore = useMenuModalsStore()
    const wrapper = mount(InProgressMessage, {
      props: { onCancel, allowBufferedIntent: true },
    })

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
    const wrapper = mount(InProgressMessage, {
      props: { allowBufferedIntent: true },
    })

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC' }))
    expect(menuModalsStore.bufferedIntent).toBe('copy')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('menu.willCopyOnFinish')

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }))
    expect(menuModalsStore.bufferedIntent).toBe('insert')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('menu.willInsertOnFinish')
  })

  it('ignores repeated keydown events so held Enter does not buffer intent', () => {
    const menuModalsStore = useMenuModalsStore()
    mount(InProgressMessage, { props: { allowBufferedIntent: true } })

    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Enter', repeat: true })
    )
    expect(menuModalsStore.bufferedIntent).toBeNull()
  })

  it('warns and does not register insert intent when target window is unavailable', async () => {
    vi.spyOn(useDesktopStore(), 'canInsertIntoWindow', 'get').mockReturnValue(
      false
    )
    const menuModalsStore = useMenuModalsStore()
    const wrapper = mount(InProgressMessage, {
      props: { allowBufferedIntent: true },
    })

    expect(wrapper.find('.hint-chip.is-disabled').exists()).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))
    expect(menuModalsStore.bufferedIntent).toBeNull()
    expect(mocks.toastKey).toHaveBeenCalledWith('selection.noTarget', 'warn')
  })

  it('offers replaceInEditor on Space when on the editor page and hides copy during editor correction', async () => {
    mocks.isEditorPage = true
    vi.spyOn(useDesktopStore(), 'canInsertIntoWindow', 'get').mockReturnValue(
      false
    )
    const menuModalsStore = useMenuModalsStore()
    const wrapper = mount(InProgressMessage, {
      props: { allowBufferedIntent: true, correction: true },
    })

    expect(wrapper.text()).toContain('menu.replaceInEditor')
    expect(wrapper.text()).not.toContain('menu.copyOnFinish')

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC' }))
    expect(menuModalsStore.bufferedIntent).toBeNull()

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))
    expect(menuModalsStore.bufferedIntent).toBe('insert')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('menu.replaceInEditor')
  })
})
