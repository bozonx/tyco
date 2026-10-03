import { describe, expect, it, vi } from 'vitest'

import { MenuModals } from './menu-modals-store'
import {
  createOverlayNavModel,
  type OverlayNavDependencies,
} from './overlay-nav'

describe('createOverlayNavModel', () => {
  const createDeps = (
    overrides: Partial<OverlayNavDependencies> = {}
  ): OverlayNavDependencies => ({
    currentModal: () => MenuModals.INSERT,
    canGoBack: () => false,
    isQuickWindow: () => true,
    t: (key: string) => key,
    goBack: vi.fn(),
    closeWindow: vi.fn(),
    ...overrides,
  })

  it('resolves to close and common.cancel in quick window when cannot go back', () => {
    const deps = createDeps({
      canGoBack: () => false,
      isQuickWindow: () => true,
      currentModal: () => MenuModals.INSERT,
    })
    const nav = createOverlayNavModel(deps)

    expect(nav.resolvedEscMode.value).toBe('close')
    expect(nav.escLabel.value).toBe('common.cancel')

    nav.handleEsc()
    expect(deps.closeWindow).toHaveBeenCalled()
    expect(deps.goBack).not.toHaveBeenCalled()
  })

  it('resolves to close and common.close in main window when cannot go back', () => {
    const deps = createDeps({
      canGoBack: () => false,
      isQuickWindow: () => false,
      currentModal: () => MenuModals.NONE,
    })
    const nav = createOverlayNavModel(deps)

    expect(nav.resolvedEscMode.value).toBe('close')
    expect(nav.escLabel.value).toBe('common.close')
  })

  it('resolves to back and common.back when canGoBack is true', () => {
    const deps = createDeps({
      canGoBack: () => true,
      currentModal: () => MenuModals.INSERT,
    })
    const nav = createOverlayNavModel(deps)

    expect(nav.resolvedEscMode.value).toBe('back')
    expect(nav.escLabel.value).toBe('common.back')

    nav.handleEsc()
    expect(deps.goBack).toHaveBeenCalled()
    expect(deps.closeWindow).not.toHaveBeenCalled()
  })

  it('resolves to back for intermediate modals even without breadcrumbs', () => {
    const deps = createDeps({
      canGoBack: () => false,
      currentModal: () => MenuModals.AI_TASK,
    })
    const nav = createOverlayNavModel(deps)

    expect(nav.resolvedEscMode.value).toBe('back')
    expect(nav.escLabel.value).toBe('common.back')
  })

  it('respects explicit escMode option', () => {
    const deps = createDeps({ canGoBack: () => true })
    const nav = createOverlayNavModel(deps, () => ({ escMode: 'close' }))

    expect(nav.resolvedEscMode.value).toBe('close')
    nav.handleEsc()
    expect(deps.closeWindow).toHaveBeenCalled()
  })

  it('respects custom escLabel and onEsc options', () => {
    const deps = createDeps()
    const customOnEsc = vi.fn()
    const nav = createOverlayNavModel(deps, () => ({
      escLabel: 'Custom Label',
      onEsc: customOnEsc,
    }))

    expect(nav.escLabel.value).toBe('Custom Label')
    nav.handleEsc()
    expect(customOnEsc).toHaveBeenCalled()
    expect(deps.closeWindow).not.toHaveBeenCalled()
    expect(deps.goBack).not.toHaveBeenCalled()
  })
})
