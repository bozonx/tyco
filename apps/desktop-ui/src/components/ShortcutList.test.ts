import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ShortcutList from './ShortcutList.vue'

const mocks = vi.hoisted(() => ({
  toEditor: vi.fn(),
  back: vi.fn(),
  closeAll: vi.fn(),
  cancelPending: vi.fn(),
  currentModalParams: {} as Record<string, unknown>,
  closeWindow: vi.fn(),
  goToEditor: vi.fn(),
  discardWriterInput: vi.fn(),
  currentWindowLabel: 'main',
  currentModal: 'insert',
  breadcrumbs: ['insert'] as string[],
  mode: 'write',
}))

vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../stores/routeParams', () => ({
  useRouteParams: () => ({ toEditor: mocks.toEditor }),
}))

vi.mock('../stores/writerInput', () => ({
  useWriterInputStore: () => ({ discard: mocks.discardWriterInput }),
}))

vi.mock('../stores/menuModals', () => ({
  MenuModals: {
    NONE: 'none',
    INSERT: 'insert',
    AI_TASK: 'ai-task',
    TRANSLATE: 'translate',
    DIFF: 'diff',
    PREVIEW: 'preview',
    ACTION_SELECT: 'action-select',
    CORRECTION: 'correction',
  },
  useMenuModalsStore: () => ({
    get currentModal() {
      return mocks.currentModal
    },
    get menuBreadcrumbs() {
      return mocks.breadcrumbs
    },
    get currentModalParams() {
      return mocks.currentModalParams
    },
    back: mocks.back,
    closeAll: mocks.closeAll,
    cancelPending: mocks.cancelPending,
  }),
}))

vi.mock('../stores/ipc', () => ({
  useIpcStore: () => ({
    callFunction: mocks.closeWindow,
    get params() {
      return { mode: mocks.mode }
    },
  }),
}))

vi.mock('../lib/navigation/navigation', () => ({
  appNavigation: { goToEditor: mocks.goToEditor },
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    get label() {
      return mocks.currentWindowLabel
    },
  }),
}))

const press = (
  code: string,
  init: KeyboardEventInit = {},
  target?: EventTarget
) => {
  const down = new KeyboardEvent('keydown', { code, ...init })
  const up = new KeyboardEvent('keyup', { code, ...init })
  if (target) {
    target.dispatchEvent(down)
    target.dispatchEvent(up)
  } else {
    window.dispatchEvent(down)
    window.dispatchEvent(up)
  }
}

describe('ShortcutList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.currentWindowLabel = 'main'
    mocks.currentModal = 'insert'
    mocks.breadcrumbs = ['insert']
    mocks.mode = 'write'
    mocks.currentModalParams = {}
  })

  it('maps actions to physical 5x3 keyboard positions without shifting', () => {
    const qAction = vi.fn()
    const aAction = vi.fn()

    const leftLetterKeys: any[] = new Array(15).fill(undefined)
    leftLetterKeys[0] = { name: 'Action Q', action: qAction } // Q (row 1, col 1)
    leftLetterKeys[5] = { name: 'Action A', action: aAction } // A (row 2, col 1)

    const wrapper = mount(ShortcutList, {
      props: {
        text: 'hello',
        leftLetterKeys,
        toEditorVisible: true,
        escVisible: true,
      },
    })

    const buttons = wrapper.findAllComponents({ name: 'ShortcutButton' })
    // Primary row has Tab and Esc, Grid has Q and A
    const buttonTexts = buttons.map((b) => b.text())
    expect(buttonTexts.some((t) => t.includes('Action Q'))).toBe(true)
    expect(buttonTexts.some((t) => t.includes('Action A'))).toBe(true)

    // Empty slots exist to preserve grid coordinates
    const emptySlots = wrapper.findAll('.shortcut-empty-slot')
    expect(emptySlots.length).toBe(13) // 15 - 2 filled = 13 empty slots
    wrapper.unmount()
  })

  it('handles Tab, Space/Enter, and custom escAction keyboard shortcuts', async () => {
    const spaceAction = vi.fn()
    const escAction = vi.fn()

    const wrapper = mount(ShortcutList, {
      props: {
        text: 'test text',
        sourceText: 'source text',
        spaceKey: { name: 'Insert', action: spaceAction },
        toEditorVisible: true,
        escVisible: true,
        escAction,
      },
    })

    // Keydown Tab should be preventDefaulted
    const tabEvent = new KeyboardEvent('keydown', {
      code: 'Tab',
      cancelable: true,
    })
    window.dispatchEvent(tabEvent)
    expect(tabEvent.defaultPrevented).toBe(true)

    // Keyup Tab should navigate to editor
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Tab' }))
    expect(mocks.toEditor).toHaveBeenCalledWith('test text', 'source text')

    // Keyup Space should trigger primary space action
    press('Space')
    expect(spaceAction).toHaveBeenCalledWith('test text')

    // Keyup Escape should trigger custom escAction
    press('Escape')
    expect(escAction).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('resolves Esc to close mode on result screens and closes quick window', () => {
    mocks.currentWindowLabel = 'quick'
    mocks.currentModal = 'insert'
    mocks.mode = 'write'

    const wrapper = mount(ShortcutList, {
      props: { text: 'result text', escVisible: true },
    })

    expect(wrapper.text()).toContain('common.cancel')
    press('Escape')

    expect(mocks.closeAll).toHaveBeenCalled()
    expect(mocks.discardWriterInput).toHaveBeenCalled()
    expect(mocks.closeWindow).toHaveBeenCalledWith('closeWindow', [])
    wrapper.unmount()
  })

  it('resolves Esc to back mode on intermediate selection screens', () => {
    mocks.currentModal = 'ai-task'
    mocks.breadcrumbs = ['insert', 'ai-task']

    const wrapper = mount(ShortcutList, {
      props: { text: 'task text', escVisible: true },
    })

    expect(wrapper.text()).toContain('common.back')
    press('Escape')

    expect(mocks.back).toHaveBeenCalled()
    expect(mocks.closeAll).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('cancels the quick window from the second step on Escape', () => {
    mocks.currentWindowLabel = 'quick'
    mocks.currentModal = 'ai-task'
    mocks.breadcrumbs = ['insert', 'ai-task']
    const cancelCorrection = vi.fn()
    mocks.currentModalParams = { onCancelCorrection: cancelCorrection }

    const wrapper = mount(ShortcutList, {
      props: { text: 'task text', escVisible: true },
    })

    expect(wrapper.text()).toContain('common.cancel')
    press('Escape')

    expect(mocks.back).not.toHaveBeenCalled()
    expect(cancelCorrection).toHaveBeenCalledOnce()
    expect(mocks.cancelPending).toHaveBeenCalled()
    expect(mocks.closeAll).toHaveBeenCalled()
    expect(mocks.discardWriterInput).toHaveBeenCalled()
    expect(mocks.closeWindow).toHaveBeenCalledWith('closeWindow', [])
    wrapper.unmount()
  })

  it('respects explicit escMode prop', () => {
    mocks.currentModal = 'insert'

    const wrapper = mount(ShortcutList, {
      props: { text: 'text', escVisible: true, escMode: 'back' },
    })

    expect(wrapper.text()).toContain('common.back')
    press('Escape')
    expect(mocks.back).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('handles Backspace keyup when canGoBack is true', () => {
    mocks.currentModal = 'diff'
    mocks.breadcrumbs = ['ai-task', 'diff']

    const wrapper = mount(ShortcutList, { props: { text: 'diff text' } })

    press('Backspace')
    expect(mocks.back).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('does not trigger Backspace navigation when focused in an editable input', () => {
    mocks.currentModal = 'diff'
    mocks.breadcrumbs = ['ai-task', 'diff']

    const wrapper = mount(ShortcutList, { props: { text: 'diff text' } })

    const input = document.createElement('input')
    document.body.appendChild(input)

    press('Backspace', {}, input)
    expect(mocks.back).not.toHaveBeenCalled()

    document.body.removeChild(input)
    wrapper.unmount()
  })

  it('triggers mapped letter key action on keyup', async () => {
    const qAction = vi.fn()
    const leftLetterKeys: any[] = [{ name: 'Action Q', action: qAction }]

    const wrapper = mount(ShortcutList, {
      props: { text: 'text for q', leftLetterKeys },
    })

    press('KeyQ')
    expect(qAction).toHaveBeenCalledWith('text for q')
    wrapper.unmount()
  })

  it('ignores the release of a key pressed before the list appeared', () => {
    const spaceAction = vi.fn()
    const wrapper = mount(ShortcutList, {
      props: {
        text: 'text',
        spaceKey: { name: 'Insert', action: spaceAction },
      },
    })

    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Enter' }))

    expect(spaceAction).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('ignores a key whose text changed while it was held', async () => {
    const spaceAction = vi.fn()
    const wrapper = mount(ShortcutList, {
      props: {
        text: 'original',
        spaceKey: { name: 'Insert', action: spaceAction },
      },
    })

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))
    await wrapper.setProps({ text: 'corrected' })
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }))
    expect(spaceAction).not.toHaveBeenCalled()

    press('Space')
    expect(spaceAction).toHaveBeenCalledWith('corrected')
    wrapper.unmount()
  })

  it('runs the primary action on the alternative text with Shift+Space', () => {
    const spaceAction = vi.fn()
    const wrapper = mount(ShortcutList, {
      props: {
        text: 'corrected',
        altText: 'original',
        spaceKey: { name: 'Insert', action: spaceAction },
      },
    })

    expect(wrapper.text()).toContain('write.insertOriginal')
    press('Space', { shiftKey: true })

    expect(spaceAction).toHaveBeenCalledWith('original')
    wrapper.unmount()
  })
})
