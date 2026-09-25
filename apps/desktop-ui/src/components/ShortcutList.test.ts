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

const press = (code: string, init: KeyboardEventInit = {}) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, ...init }))
  window.dispatchEvent(new KeyboardEvent('keyup', { code, ...init }))
}

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
    press('Space')
    expect(spaceAction).toHaveBeenCalledWith('test text')

    // Keyup Escape should trigger escAction
    press('Escape')
    expect(escAction).toHaveBeenCalled()
  })

  it('triggers mapped letter key action on keyup', async () => {
    const qAction = vi.fn()
    const leftLetterKeys: any[] = [{ name: 'Action Q', action: qAction }]

    mount(ShortcutList, { props: { text: 'text for q', leftLetterKeys } })

    press('KeyQ')
    expect(qAction).toHaveBeenCalledWith('text for q')
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
