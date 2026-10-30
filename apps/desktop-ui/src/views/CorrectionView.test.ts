import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadFakeDesktop, type TestDesktop } from '../test/install-fake-desktop'
import CorrectionView from './CorrectionView.vue'

const mocks = vi.hoisted(() => ({
  navPanel: { resetNavPanelState: vi.fn() },
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
vi.mock('../components/overlay/ActionOverlayLayout.vue', () => ({
  default: {
    props: ['title', 'onEsc'],
    template:
      '<div><slot /><button class="close-btn" @click="onEsc()">Close</button></div>',
  },
}))

vi.mock('../stores/nav-panel', () => ({
  useNavPanelStore: () => mocks.navPanel,
}))

vi.mock('../stores/action-menu', () => ({
  useActionMenuStore: () => ({ correct: mocks.correct }),
}))

describe('CorrectionView', () => {
  let desktop: TestDesktop
  const loadSelection = async (selectedText: string | null) => {
    desktop?.dispose()
    desktop = await loadFakeDesktop({
      mode: 'correction',
      activation: { activationId: 1, selectedText },
    })
    desktop.backend.handle('hide_window', () => undefined)
  }
  const hideCount = async () => {
    await flushPromises()
    return desktop.backend.callsOf('hide_window').length
  }
  const mountView = () =>
    mount(CorrectionView, { global: { plugins: [desktop.pinia] } })

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.correct.mockReset().mockResolvedValue(undefined)
    await loadSelection('Selected text')
  })

  afterEach(() => desktop.dispose())

  it('shows an explanation and a close action when no selection was captured', async () => {
    await loadSelection(null)
    const wrapper = mountView()
    expect(wrapper.text()).toContain('toast.textNotSelected')
    expect(mocks.correct).not.toHaveBeenCalled()
    await wrapper.find('.close-btn').trigger('click')
    expect(await hideCount()).toBe(1)
    wrapper.unmount()
  })

  it('does not let cancellation from an old correction hide a new activation', async () => {
    const wrapper = mountView()
    await flushPromises()
    const onCancel = mocks.correct.mock.calls[0]![1].onCancel
    desktop.setState({ activationId: 2 })
    onCancel()
    expect(await hideCount()).toBe(0)
    wrapper.unmount()
  })

  it('passes onCancel handler to actionMenuStore.correct', async () => {
    mountView()
    await flushPromises()

    expect(mocks.correct).toHaveBeenCalledWith('Selected text', {
      insertOnly: true,
      onCancel: expect.any(Function),
    })
  })

  it('closes window when onCancel callback passed to correct is called', async () => {
    mountView()
    await flushPromises()

    const options = mocks.correct.mock.calls[0]?.[1]
    expect(options?.onCancel).toBeTypeOf('function')

    options.onCancel()
    expect(await hideCount()).toBe(1)
  })

  it('closes window when cancel button in InProgressMessage is clicked', async () => {
    let capturedOnCancel: (() => void) | undefined
    mocks.correct.mockImplementation((_text, options) => {
      capturedOnCancel = options?.onCancel
      return new Promise(() => {})
    })

    const wrapper = mountView()
    await flushPromises()

    const cancelBtn = wrapper.find('.cancel-btn')
    expect(cancelBtn.exists()).toBe(true)

    await cancelBtn.trigger('click')
    expect(await hideCount()).toBeGreaterThan(0)

    if (capturedOnCancel) {
      capturedOnCancel()
      expect(await hideCount()).toBeGreaterThan(0)
    }
  })
})
