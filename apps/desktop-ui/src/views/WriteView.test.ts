import { mount } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubmitKey } from '@tyco/shared'
import WriteView from './WriteView.vue'

const mocks = vi.hoisted(() => ({
  desktopState: {
    isWindowShown: true,
    mode: 'quickInput',
    activationId: 1,
    userConfig: { editor: { submitKey: undefined as SubmitKey | undefined } },
  },
  writer: {
    value: 'Original text',
    recallText: '',
    requestFocus: vi.fn(),
    requestFocusAndSelectAll: vi.fn(),
    startSession: vi.fn(),
    rememberSubmitted: vi.fn(),
    markDismissed: vi.fn(),
    discard: vi.fn(),
    clear: vi.fn(),
    setValue: vi.fn(),
  },
  modals: {
    hasOpenModal: false,
    pendingModal: null as object | null,
    nextModal: vi.fn(),
    cancelPending: vi.fn(),
    closeAll: vi.fn(),
  },
  correction: {
    insert: vi.fn(),
    insertLive: vi.fn(),
    nextLive: vi.fn(),
    insertDirect: vi.fn(),
    cancelInsert: vi.fn(),
    schedulePrecorrection: vi.fn(),
    cancelPrecorrection: vi.fn(),
  },
  textCorrection: {
    liveStatus: 'idle' as string,
    liveCorrectedText: '',
    handleLiveInput: vi.fn(),
    getFinalCorrection: vi.fn(),
    resetLive: vi.fn(),
    cancelLive: vi.fn(),
  },
  updateUserConfig: vi.fn(),
  call: vi.fn(),
}))
vi.mock('../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('../stores/window', () => ({
  useWindowStore: () => ({ hide: () => mocks.call('hide_window') }),
}))
vi.mock('../stores/ipc', () => ({
  useIpcStore: () => ({ call: mocks.call, callOrNotify: mocks.call }),
}))
vi.mock('../stores/desktop', async () => {
  const { mockDesktopStore } = await import('../test/desktop-store')
  return {
    useDesktopStore: () =>
      mockDesktopStore(() => reactive(mocks.desktopState), {
        updateUserConfig: mocks.updateUserConfig,
      }),
  }
})
vi.mock('../stores/quick-input', () => ({
  useQuickInputStore: () => reactive(mocks.writer),
}))
vi.mock('../stores/text-correction', () => ({
  useTextCorrectionStore: () => reactive(mocks.textCorrection),
}))
vi.mock('../stores/menu-modals', () => ({
  MenuModals: { INSERT: 'insert' },
  useMenuModalsStore: () => reactive(mocks.modals),
}))
vi.mock('../stores/correction-workflow', () => ({
  useCorrectionWorkflowStore: () => mocks.correction,
}))
vi.mock('../stores/nav-panel', () => ({
  useNavPanelStore: () => ({ resetNavPanelState: vi.fn() }),
}))
vi.mock('../components/quick/WriteModeInput.vue', async () => {
  const { defineComponent, ref } = await import('vue')
  return {
    default: defineComponent({
      setup(_props, { expose }) {
        const element = ref<HTMLTextAreaElement | null>(null)
        expose({
          getSelection: () =>
            element.value
              ? {
                  start: element.value.selectionStart,
                  end: element.value.selectionEnd,
                }
              : null,
          focus: () => element.value?.focus(),
          select: (start: number, end: number) =>
            element.value?.setSelectionRange(start, end),
          isFocused: () => document.activeElement === element.value,
        })
        return { element }
      },
      template: '<textarea ref="element" />',
    }),
  }
})

let wrapper: ReturnType<typeof mount>
const press = (code: string, options: KeyboardEventInit = {}) =>
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      code,
      key: code,
      bubbles: true,
      cancelable: true,
      ...options,
    })
  )
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  mocks.desktopState.isWindowShown = true
  mocks.desktopState.userConfig = {
    editor: { submitKey: undefined },
  } as unknown as typeof mocks.desktopState.userConfig
  mocks.writer.value = 'Original text'
  mocks.modals.pendingModal = null
  mocks.modals.hasOpenModal = false
  wrapper = mount(WriteView)
  vi.clearAllMocks()
})
afterEach(() => {
  wrapper.unmount()
  vi.unstubAllGlobals()
})

describe('quick input screen', () => {
  it('corrects and inserts on Enter without opening the next step', () => {
    press('Enter')
    expect(mocks.correction.insert).toHaveBeenCalledWith('Original text')
    expect(mocks.modals.nextModal).not.toHaveBeenCalled()
  })

  it('opens actions on Tab with original text and ignores other Enters', () => {
    press('Enter', { altKey: true })
    press('Enter', { ctrlKey: true })
    expect(mocks.correction.insert).not.toHaveBeenCalled()
    expect(mocks.modals.nextModal).not.toHaveBeenCalled()
    press('Tab')
    expect(mocks.modals.nextModal).toHaveBeenCalledWith('insert', {
      text: 'Original text',
    })
    expect(mocks.correction.insert).not.toHaveBeenCalled()
  })

  it('keeps newline and cancel behavior', () => {
    press('Enter', { shiftKey: true })
    expect(mocks.writer.setValue).toHaveBeenCalled()
    press('Escape')
    expect(mocks.writer.discard).toHaveBeenCalledOnce()
    expect(mocks.correction.cancelInsert).toHaveBeenCalledOnce()
    expect(mocks.call).toHaveBeenCalledWith('hide_window')
  })

  it('blocks duplicate submissions while pending but allows cancellation', async () => {
    reactive(mocks.modals).pendingModal = {}
    await nextTick()
    press('Enter')
    press('Tab')
    expect(mocks.correction.insert).not.toHaveBeenCalled()
    expect(mocks.modals.nextModal).not.toHaveBeenCalled()
    press('Escape')
    expect(mocks.modals.cancelPending).toHaveBeenCalledOnce()
  })

  it('sends with Ctrl+Enter in that mode and updates the hint', async () => {
    reactive(mocks.desktopState).userConfig.editor.submitKey = 'Ctrl+Enter'
    await nextTick()
    press('Enter')
    expect(mocks.correction.insert).not.toHaveBeenCalled()
    expect(mocks.writer.setValue).toHaveBeenCalledOnce()
    press('Enter', { ctrlKey: true })
    expect(mocks.correction.insert).toHaveBeenCalledWith('Original text')
    expect(wrapper.text()).toContain('Ctrl+Enter')
  })

  it('ignores composition and repeated submission keys', () => {
    press('Enter', { isComposing: true })
    press('Enter', { repeat: true })
    expect(mocks.correction.insert).not.toHaveBeenCalled()
  })

  it('cancels pending insertion when hidden or reactivated', async () => {
    reactive(mocks.desktopState).isWindowShown = false
    await nextTick()
    expect(mocks.correction.cancelInsert).toHaveBeenCalledOnce()
    reactive(mocks.desktopState).activationId++
    await nextTick()
    expect(mocks.correction.cancelInsert).toHaveBeenCalledTimes(2)
  })

  it('selects a kept text on reopening and focuses an empty one', async () => {
    const desktopState = reactive(mocks.desktopState)
    desktopState.isWindowShown = true
    mocks.writer.startSession.mockReturnValueOnce(true)
    desktopState.activationId++
    await nextTick()
    expect(mocks.writer.requestFocusAndSelectAll).toHaveBeenCalledOnce()
    expect(mocks.writer.requestFocus).not.toHaveBeenCalled()

    mocks.writer.startSession.mockReturnValueOnce(false)
    desktopState.activationId++
    await nextTick()
    expect(mocks.writer.requestFocus).toHaveBeenCalledOnce()
  })

  it('brings back the recallable text on ArrowUp in an empty input', () => {
    const writer = reactive(mocks.writer)
    writer.value = ''
    writer.recallText = 'cancelled text'
    press('ArrowUp')
    expect(mocks.writer.setValue).toHaveBeenCalledWith('cancelled text')
    writer.value = 'Original text'
    writer.recallText = ''
  })

  it('handles live correction mode and submits via insertLive', async () => {
    const desktopState = reactive(mocks.desktopState)
    desktopState.userConfig = {
      ...desktopState.userConfig,
      quickWindow: {
        isHiddenOnBlur: true,
        isCorrectionPrefetchEnabled: false,
        correctionMode: 'live',
      },
    } as unknown as typeof desktopState.userConfig
    await nextTick()

    const writer = reactive(mocks.writer)
    writer.value = 'Live input'
    await nextTick()
    expect(mocks.textCorrection.handleLiveInput).toHaveBeenCalledWith(
      'Live input'
    )

    press('Enter')
    expect(mocks.correction.insertLive).toHaveBeenCalledWith('Live input')

    press('Tab')
    expect(mocks.correction.nextLive).toHaveBeenCalledWith('Live input')
    expect(mocks.modals.nextModal).not.toHaveBeenCalled()
  })

  it('handles off correction mode and submits via insertDirect', async () => {
    const desktopState = reactive(mocks.desktopState)
    desktopState.userConfig = {
      ...desktopState.userConfig,
      quickWindow: {
        isHiddenOnBlur: true,
        isCorrectionPrefetchEnabled: false,
        correctionMode: 'off',
      },
    } as unknown as typeof desktopState.userConfig
    await nextTick()

    press('Enter')
    expect(mocks.correction.insertDirect).toHaveBeenCalledWith('Original text')
  })

  it('shows current correction mode in the hint bar and cycles it on click', async () => {
    const modeSwitch = wrapper.get('.write-mode-switch')
    expect(modeSwitch.text()).toContain('settings.quickCorrectionOnSubmit')

    await modeSwitch.trigger('click')
    expect(mocks.updateUserConfig).toHaveBeenCalledWith({
      quickWindow: {
        isHiddenOnBlur: true,
        isCorrectionPrefetchEnabled: false,
        correctionMode: 'off',
      },
    })
  })
})
