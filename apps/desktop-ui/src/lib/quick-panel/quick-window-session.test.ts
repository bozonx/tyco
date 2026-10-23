import { describe, expect, it, vi } from 'vitest'

import { createQuickWindowSession } from './quick-window-session'

function setup(state: Partial<Record<string, unknown>> = {}) {
  const current = {
    mode: 'quickInput',
    isWindowShown: true,
    isLauncherPastList: false,
    hasModal: false,
    hasPendingModal: false,
    isHideOnBlurEnabled: true,
    isDismissHeld: false,
    ...state,
  }
  const deps = {
    mode: () => current.mode as string,
    isWindowShown: () => current.isWindowShown as boolean,
    isLauncherPastList: () => current.isLauncherPastList as boolean,
    hasModal: () => current.hasModal as boolean,
    hasPendingModal: () => current.hasPendingModal as boolean,
    isHideOnBlurEnabled: () => current.isHideOnBlurEnabled as boolean,
    isDismissHeld: () => current.isDismissHeld as boolean,
    markInputDismissed: vi.fn(),
    cancelAndCloseModals: vi.fn(),
    dismissWindow: vi.fn(),
  }
  return { current, deps, session: createQuickWindowSession(deps) }
}

describe('quick window session', () => {
  it('lets only the first step go on a focus loss', () => {
    expect(setup().session.canDismissOnFocusLoss()).toBe(true)
    expect(setup({ hasModal: true }).session.keepsOnFocusLoss()).toBe(true)
    expect(setup({ hasPendingModal: true }).session.keepsOnFocusLoss()).toBe(
      true
    )
    expect(setup({ mode: 'voice' }).session.keepsOnFocusLoss()).toBe(true)
    // a correction on its way is past the first step
    expect(setup({ mode: 'correction' }).session.keepsOnFocusLoss()).toBe(true)
    expect(setup({ mode: 'commandLauncher' }).session.keepsOnFocusLoss()).toBe(
      false
    )
    expect(
      setup({
        mode: 'commandLauncher',
        isLauncherPastList: true,
      }).session.keepsOnFocusLoss()
    ).toBe(true)
  })

  it('stays while hidden, held or set to stay', () => {
    expect(
      setup({ isWindowShown: false }).session.canDismissOnFocusLoss()
    ).toBe(false)
    expect(setup({ isDismissHeld: true }).session.canDismissOnFocusLoss()).toBe(
      false
    )
    expect(
      setup({ isHideOnBlurEnabled: false }).session.canDismissOnFocusLoss()
    ).toBe(false)
  })

  it('keeps the typed text of a dismissed input for the next opening', () => {
    const { deps, session } = setup()
    session.dismiss()
    expect(deps.markInputDismissed).toHaveBeenCalledOnce()
    expect(deps.cancelAndCloseModals).toHaveBeenCalledOnce()
    expect(deps.dismissWindow).toHaveBeenCalledOnce()

    const menu = setup({ mode: 'selectionActions' })
    menu.session.dismiss()
    expect(menu.deps.markInputDismissed).not.toHaveBeenCalled()
  })

  it('drops the work of an ended activation', () => {
    const { deps, session } = setup()
    session.endActivation()
    expect(deps.cancelAndCloseModals).toHaveBeenCalledOnce()
  })
})
