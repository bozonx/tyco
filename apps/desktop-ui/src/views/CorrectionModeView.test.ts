import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CorrectionModeView from './CorrectionModeView.vue'

const mocks = vi.hoisted(() => ({
  desktopState: {
    selectedText: 'Selected text' as string | null,
    isWindowShown: true,
    mode: 'correction',
    activationId: 1,
  },
  navPanel: { resetNavPanelState: vi.fn() },
  callFunctionOrNotify: vi.fn(),
  correct: vi.fn(),
}))

vi.mock('../components/common/ContentPadding.vue', () => ({
  default: { template: '<div><slot /></div>' },
}))

vi.mock('../components/menu/InProgressMessage.vue', () => ({
  default: {
    name: 'InProgressMessage',
    props: ['correction', 'onCancel'],
    template:
      '<button class="cancel-btn" @click="onCancel?.()">Cancel</button>',
  },
}))

vi.mock('../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('../composables/use-toast', () => ({
  default: () => ({ toastText: vi.fn() }),
}))
vi.mock('../components/common/ActionOverlayLayout.vue', () => ({
  default: {
    props: ['title', 'onEsc'],
    template:
      '<div><slot /><button class="close-btn" @click="onEsc()">Close</button></div>',
  },
}))

vi.mock('../stores/ipc', () => ({
  useIpcStore: () => ({
    desktopState: reactive(mocks.desktopState),
    callFunctionOrNotify: mocks.callFunctionOrNotify,
  }),
}))

vi.mock('../stores/nav-panel', () => ({
  useNavPanelStore: () => mocks.navPanel,
}))

vi.mock('../stores/action-menu', () => ({
  useActionMenuStore: () => ({ correct: mocks.correct }),
}))

describe('CorrectionModeView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.correct.mockReset().mockResolvedValue(undefined)
    mocks.desktopState.selectedText = 'Selected text'
    mocks.desktopState.activationId = 1
  })

  it('shows an explanation and a close action when no selection was captured', async () => {
    mocks.desktopState.selectedText = null
    const wrapper = mount(CorrectionModeView)
    expect(wrapper.text()).toContain('toast.textNotSelected')
    expect(mocks.correct).not.toHaveBeenCalled()
    await wrapper.find('.close-btn').trigger('click')
    expect(mocks.callFunctionOrNotify).toHaveBeenCalledWith('hideWindow')
    wrapper.unmount()
  })

  it('does not let cancellation from an old correction hide a new activation', async () => {
    const wrapper = mount(CorrectionModeView)
    await flushPromises()
    const onCancel = mocks.correct.mock.calls[0]![1].onCancel
    reactive(mocks.desktopState).activationId++
    onCancel()
    expect(mocks.callFunctionOrNotify).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('passes onCancel handler to actionMenuStore.correct', async () => {
    mount(CorrectionModeView)
    await flushPromises()

    expect(mocks.correct).toHaveBeenCalledWith('Selected text', {
      insertOnly: true,
      onCancel: expect.any(Function),
    })
  })

  it('closes window when onCancel callback passed to correct is called', async () => {
    mount(CorrectionModeView)
    await flushPromises()

    const options = mocks.correct.mock.calls[0]?.[1]
    expect(options?.onCancel).toBeTypeOf('function')

    options.onCancel()
    expect(mocks.callFunctionOrNotify).toHaveBeenCalledWith('hideWindow')
  })

  it('closes window when cancel button in InProgressMessage is clicked', async () => {
    let capturedOnCancel: (() => void) | undefined
    mocks.correct.mockImplementation((_text, options) => {
      capturedOnCancel = options?.onCancel
      return new Promise(() => {})
    })

    const wrapper = mount(CorrectionModeView)
    await flushPromises()

    const cancelBtn = wrapper.find('.cancel-btn')
    expect(cancelBtn.exists()).toBe(true)

    await cancelBtn.trigger('click')
    expect(mocks.callFunctionOrNotify).toHaveBeenCalledWith('hideWindow')

    if (capturedOnCancel) {
      capturedOnCancel()
      expect(mocks.callFunctionOrNotify).toHaveBeenCalledWith('hideWindow')
    }
  })
})
