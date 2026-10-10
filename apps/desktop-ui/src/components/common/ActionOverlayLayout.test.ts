import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ActionOverlayLayout from './ActionOverlayLayout.vue'

const mocks = vi.hoisted(() => ({
  currentWindowLabel: 'quick',
  currentModal: 'insert',
  breadcrumbs: [] as string[],
  closeAll: vi.fn(),
  back: vi.fn(),
  closeWindow: vi.fn(),
  discardWriterInput: vi.fn(),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: mocks.currentWindowLabel }),
}))

vi.mock('../../stores/menuModals', () => ({
  MenuModals: { NONE: 'none', INSERT: 'insert', AI_TASK: 'ai-task' },
  useMenuModalsStore: () => ({
    currentModal: mocks.currentModal,
    menuBreadcrumbs: mocks.breadcrumbs,
    closeAll: mocks.closeAll,
    back: mocks.back,
    cancelPending: vi.fn(),
  }),
}))

vi.mock('../../stores/ipc', () => ({
  useIpcStore: () => ({
    params: { mode: 'write' },
    callFunctionOrNotify: mocks.closeWindow,
  }),
}))

vi.mock('../../stores/writerInput', () => ({
  useWriterInputStore: () => ({ discard: mocks.discardWriterInput }),
}))

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('ActionOverlayLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.currentWindowLabel = 'quick'
    mocks.currentModal = 'insert'
    mocks.breadcrumbs = []
  })

  it('renders title and Esc button in the header', () => {
    const wrapper = mount(ActionOverlayLayout, {
      props: { title: 'Test Title' },
    })

    expect(wrapper.find('.action-overlay-title').text()).toBe('Test Title')
    const escButton = wrapper.find('.action-overlay-esc')
    expect(escButton.exists()).toBe(true)
    expect(escButton.text()).toContain('Esc')
    expect(escButton.text()).toContain('common.cancel')
  })

  it('shows back label when breadcrumbs exist', () => {
    mocks.breadcrumbs = ['insert', 'preview']
    const wrapper = mount(ActionOverlayLayout, {
      props: { title: 'Test Title' },
    })

    expect(wrapper.find('.action-overlay-esc').text()).toContain('common.back')
  })

  it('hides Esc button when escVisible is false', () => {
    const wrapper = mount(ActionOverlayLayout, {
      props: { title: 'Test Title', escVisible: false },
    })

    expect(wrapper.find('.action-overlay-esc').exists()).toBe(false)
  })

  it('triggers onEsc when clicked', async () => {
    const onEsc = vi.fn()
    const wrapper = mount(ActionOverlayLayout, {
      props: { title: 'Test Title', onEsc },
    })

    await wrapper.find('.action-overlay-esc').trigger('click')
    expect(onEsc).toHaveBeenCalled()
    expect(mocks.closeWindow).not.toHaveBeenCalled()
  })

  it('triggers closeWindow when clicked in quick window without breadcrumbs', async () => {
    const wrapper = mount(ActionOverlayLayout, {
      props: { title: 'Test Title' },
    })

    await wrapper.find('.action-overlay-esc').trigger('click')
    expect(mocks.closeAll).toHaveBeenCalled()
    expect(mocks.discardWriterInput).toHaveBeenCalled()
    expect(mocks.closeWindow).toHaveBeenCalledWith('closeWindow')
  })

  it('triggers closeWindow when only current modal is in breadcrumbs', async () => {
    mocks.breadcrumbs = ['insert']
    const wrapper = mount(ActionOverlayLayout, {
      props: { title: 'Test Title' },
    })

    expect(wrapper.find('.action-overlay-esc').text()).toContain(
      'common.cancel'
    )
    await wrapper.find('.action-overlay-esc').trigger('click')
    expect(mocks.closeWindow).toHaveBeenCalledWith('closeWindow')
  })
})
