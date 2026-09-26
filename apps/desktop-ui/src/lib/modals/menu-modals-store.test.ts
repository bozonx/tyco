import { describe, expect, it, vi } from 'vitest'

import { MenuModals, createMenuModalsStoreModel } from './menu-modals-store'

describe('createMenuModalsStoreModel', () => {
  it('starts with NONE and no breadcrumbs', () => {
    const store = createMenuModalsStoreModel()
    expect(store.currentModal.value).toBe(MenuModals.NONE)
    expect(store.anyModalOpen.value).toBe(false)
    expect(store.menuBreadcrumbs.value).toEqual([])
  })

  it('navigates to next modal and calls resetGlobalFocus', () => {
    const resetGlobalFocus = vi.fn()
    const store = createMenuModalsStoreModel({ resetGlobalFocus })

    store.nextModal(MenuModals.TRANSLATE, { text: 'hello' })

    expect(resetGlobalFocus).toHaveBeenCalled()
    expect(store.currentModal.value).toBe(MenuModals.TRANSLATE)
    expect(store.currentModalParams.value).toEqual({ text: 'hello' })
    expect(store.anyModalOpen.value).toBe(true)
    expect(store.menuBreadcrumbs.value).toEqual([MenuModals.TRANSLATE])
  })

  it('handles back navigation correctly across stack', () => {
    const store = createMenuModalsStoreModel()

    store.nextModal(MenuModals.AI_TASK, { text: 'first' })
    store.nextModal(MenuModals.INSERT, { text: 'second' })

    expect(store.menuBreadcrumbs.value).toEqual([
      MenuModals.AI_TASK,
      MenuModals.INSERT,
    ])

    store.back()
    expect(store.currentModal.value).toBe(MenuModals.AI_TASK)
    expect(store.menuBreadcrumbs.value).toEqual([MenuModals.AI_TASK])

    store.back()
    expect(store.currentModal.value).toBe(MenuModals.NONE)
    expect(store.anyModalOpen.value).toBe(false)
    expect(store.menuBreadcrumbs.value).toEqual([])
  })

  it('closes all and resets state', () => {
    const store = createMenuModalsStoreModel()

    store.nextModal(MenuModals.AI_TASK)
    store.setPendingModal({ correction: true })

    expect(store.pendingModal.value).toEqual({ correction: true })

    store.closeAll()

    expect(store.currentModal.value).toBe(MenuModals.NONE)
    expect(store.currentModalParams.value).toEqual({})
    expect(store.menuBreadcrumbs.value).toEqual([])
    expect(store.pendingModal.value).toBeNull()
  })

  it('cancels the pending operation through its onCancel', () => {
    const store = createMenuModalsStoreModel()
    const onCancel = vi.fn()

    store.setPendingModal({ correction: true, onCancel })
    store.cancelPending()

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(store.pendingModal.value).toBeNull()
    expect(() => store.cancelPending()).not.toThrow()
  })

  it('restores the params of the step it goes back to', () => {
    const store = createMenuModalsStoreModel()

    store.nextModal(MenuModals.INSERT, { text: 'typed' })
    store.nextModal(MenuModals.INSERT, { text: 'corrected' })
    store.back()

    expect(store.currentModalParams.value).toEqual({ text: 'typed' })
  })

  it('calls onLeave of the steps it removes', () => {
    const store = createMenuModalsStoreModel()
    const first = vi.fn()
    const second = vi.fn()

    store.nextModal(MenuModals.INSERT, { onLeave: first })
    store.nextModal(MenuModals.INSERT, { onLeave: second })
    store.back()

    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()

    store.closeAll()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('updates the params only of a step still on the stack', () => {
    const store = createMenuModalsStoreModel()

    const lower = store.nextModal(MenuModals.INSERT, { text: 'a' })
    const upper = store.nextModal(MenuModals.INSERT, { correcting: true })

    expect(store.updateStep(lower, { text: 'b' })).toBe(true)
    expect(store.updateStep(upper, { correcting: false })).toBe(true)
    expect(store.currentModalParams.value).toEqual({ correcting: false })
    expect(store.currentStepId.value).toBe(upper)

    store.back()
    expect(store.currentModalParams.value).toEqual({ text: 'b' })
    expect(store.hasStep(upper)).toBe(false)
    expect(store.updateStep(upper, { text: 'c' })).toBe(false)
  })
})
