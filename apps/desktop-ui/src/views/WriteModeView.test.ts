import { mount } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuickInputHotkeys } from '@tyco/shared'
import WriteModeView from './WriteModeView.vue'

const mocks = vi.hoisted(() => ({
  params: {
    isWindowShown: true,
    mode: 'write',
    activationId: 1,
    userConfig: { quickInputHotkeys: {} as Partial<QuickInputHotkeys> },
  },
  writer: {
    value: 'Original text',
    lastSubmitted: '',
    focus: vi.fn(),
    focusAndSelectAll: vi.fn(),
    startSession: vi.fn(),
    rememberSubmitted: vi.fn(),
    markDismissed: vi.fn(),
    discard: vi.fn(),
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
  mocks.params.userConfig.quickInputHotkeys = {}
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
    expect(mocks.correction.insert).toHaveBeenCalledWith('Original text', true)
    expect(mocks.modals.nextModal).not.toHaveBeenCalled()
  })

  it('opens actions on Tab with original text and ignores Alt+Enter', () => {
    press('Enter', { altKey: true })
    expect(mocks.correction.insert).not.toHaveBeenCalled()
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
    expect(mocks.callFunction).toHaveBeenCalledWith('closeWindow', [])
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

  it('honors reassignment and updates the hint', async () => {
    reactive(mocks.params).userConfig.quickInputHotkeys = { next: 'Ctrl+D' }
    await nextTick()
    press('Tab')
    expect(mocks.modals.nextModal).not.toHaveBeenCalled()
    press('KeyD', { ctrlKey: true })
    expect(mocks.modals.nextModal).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('Ctrl+D')
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
})
