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
    store.nextModal(MenuModals.CORRECTION, { text: 'second' })

    expect(store.menuBreadcrumbs.value).toEqual([
      MenuModals.AI_TASK,
      MenuModals.CORRECTION,
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

  it('updates the params only of the modal still on screen', () => {
    const store = createMenuModalsStoreModel()

    store.nextModal(MenuModals.INSERT, { text: 'a', correcting: true })

    expect(
      store.updateModalParams(MenuModals.INSERT, { correcting: false })
    ).toBe(true)
    expect(store.currentModalParams.value).toEqual({
      text: 'a',
      correcting: false,
    })

    store.closeAll()
    expect(store.updateModalParams(MenuModals.INSERT, { text: 'b' })).toBe(
      false
    )
    expect(store.currentModalParams.value).toEqual({})
  })
})
