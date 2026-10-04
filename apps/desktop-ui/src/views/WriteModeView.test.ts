import { mount } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubmitKey } from '@tyco/shared'
import WriteModeView from './WriteModeView.vue'

const mocks = vi.hoisted(() => ({
  params: {
    isWindowShown: true,
    mode: 'write',
    activationId: 1,
    userConfig: { submitKey: undefined as SubmitKey | undefined },
  },
  writer: {
    value: 'Original text',
    recallText: '',
    focus: vi.fn(),
    focusAndSelectAll: vi.fn(),
    startSession: vi.fn(),
    rememberSubmitted: vi.fn(),
    markDismissed: vi.fn(),
    discard: vi.fn(),
    clear: vi.fn(),
    setValue: vi.fn(),
  },
  modals: {
    anyModalOpen: false,
    pendingModal: null as object | null,
    nextModal: vi.fn(),
    cancelPending: vi.fn(),
    closeAll: vi.fn(),
  },
  correction: {
    insert: vi.fn(),
    cancelInsert: vi.fn(),
    speculate: vi.fn(),
    cancelSpeculation: vi.fn(),
  },
  callFunction: vi.fn(),
}))
vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('../stores/ipc', () => ({
  useIpcStore: () => ({
    params: reactive(mocks.params),
    callFunction: mocks.callFunction,
    callFunctionOrNotify: mocks.callFunction,
  }),
}))
vi.mock('../stores/writerInput', () => ({
  useWriterInputStore: () => reactive(mocks.writer),
}))
vi.mock('../stores/menuModals', () => ({
  MenuModals: { INSERT: 'insert' },
  useMenuModalsStore: () => reactive(mocks.modals),
}))
vi.mock('../stores/correction', () => ({
  useCorrectionStore: () => mocks.correction,
}))
vi.mock('../stores/navPanel', () => ({
  useNavPanelStore: () => ({ resetNavParams: vi.fn() }),
}))
vi.mock('../components/WriteModeInput.vue', () => ({
  default: { template: '<textarea />' },
}))

let wrapper: ReturnType<typeof mount>
const press = (code: string, options: KeyboardEventInit = {}) =>
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      code,
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
  mocks.params.isWindowShown = true
  mocks.params.userConfig.submitKey = undefined
  mocks.modals.pendingModal = null
  mocks.modals.anyModalOpen = false
  wrapper = mount(WriteModeView)
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
    expect(mocks.callFunction).toHaveBeenCalledWith('closeWindow')
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
    reactive(mocks.params).userConfig.submitKey = 'ctrlEnter'
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
    reactive(mocks.params).isWindowShown = false
    await nextTick()
    expect(mocks.correction.cancelInsert).toHaveBeenCalledOnce()
    reactive(mocks.params).activationId++
    await nextTick()
    expect(mocks.correction.cancelInsert).toHaveBeenCalledTimes(2)
  })

  it('selects a kept text on reopening and focuses an empty one', async () => {
    const params = reactive(mocks.params)
    params.isWindowShown = true
    mocks.writer.startSession.mockReturnValueOnce(true)
    params.activationId++
    await nextTick()
    expect(mocks.writer.focusAndSelectAll).toHaveBeenCalledOnce()
    expect(mocks.writer.focus).not.toHaveBeenCalled()

    mocks.writer.startSession.mockReturnValueOnce(false)
    params.activationId++
    await nextTick()
    expect(mocks.writer.focus).toHaveBeenCalledOnce()
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
})
