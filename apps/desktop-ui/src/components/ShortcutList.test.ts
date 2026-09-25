import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import ShortcutList from './ShortcutList.vue'

const mocks = vi.hoisted(() => ({
  toEditor: vi.fn(),
  back: vi.fn(),
  closeWindow: vi.fn(),
  goToEditor: vi.fn(),
}))

vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../stores/routeParams', () => ({
  useRouteParams: () => ({ toEditor: mocks.toEditor }),
}))

vi.mock('../stores/menuModals', () => ({
  MenuModals: { NONE: 'none', INSERT: 'insert' },
  useMenuModalsStore: () => ({ currentModal: 'insert', back: mocks.back }),
}))

vi.mock('../stores/ipc', () => ({
  useIpcStore: () => ({ callFunction: mocks.closeWindow }),
}))

vi.mock('../lib/navigation/navigation', () => ({
  appNavigation: { goToEditor: mocks.goToEditor },
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'main' }),
}))

describe('ShortcutList', () => {
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
  })

  it('handles Tab, Space/Enter, and Esc keyboard shortcuts', async () => {
    const spaceAction = vi.fn()
    const escAction = vi.fn()

    mount(ShortcutList, {
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
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }))
    expect(spaceAction).toHaveBeenCalledWith('test text')

    // Keyup Escape should trigger escAction
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape' }))
    expect(escAction).toHaveBeenCalled()
  })

  it('triggers mapped letter key action on keyup', async () => {
    const qAction = vi.fn()
    const leftLetterKeys: any[] = [{ name: 'Action Q', action: qAction }]

    mount(ShortcutList, { props: { text: 'text for q', leftLetterKeys } })

    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyQ' }))
    expect(qAction).toHaveBeenCalledWith('text for q')
  })
})
