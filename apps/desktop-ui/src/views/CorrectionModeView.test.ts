import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CorrectionModeView from './CorrectionModeView.vue'

const mocks = vi.hoisted(() => ({
  params: {
    selectedText: 'Selected text' as string | null,
    isWindowShown: true,
    mode: 'correction',
  },
  navPanel: { resetNavParams: vi.fn() },
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

vi.mock('../stores/ipc', () => ({
  useIpcStore: () => ({
    params: reactive(mocks.params),
    callFunctionOrNotify: mocks.callFunctionOrNotify,
  }),
}))

vi.mock('../stores/navPanel', () => ({
  useNavPanelStore: () => mocks.navPanel,
}))

vi.mock('../stores/actionMenu', () => ({
  useActionMenuStore: () => ({ correct: mocks.correct }),
}))

describe('CorrectionModeView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.params.selectedText = 'Selected text'
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
    expect(mocks.callFunctionOrNotify).toHaveBeenCalledWith('closeWindow')
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
    expect(mocks.callFunctionOrNotify).toHaveBeenCalledWith('closeWindow')

    if (capturedOnCancel) {
      capturedOnCancel()
      expect(mocks.callFunctionOrNotify).toHaveBeenCalledWith('closeWindow')
    }
  })
})
