import { describe, expect, it, vi } from 'vitest'

import { MenuModals, createMenuModalsStoreModel } from './menu-modals-store'

describe('createMenuModalsStoreModel', () => {
  it('starts with NONE and no breadcrumbs', () => {
    const store = createMenuModalsStoreModel()
    expect(store.currentModal.value).toBe(MenuModals.NONE)
    expect(store.anyModalOpen.value).toBe(false)
    expect(store.menuBreadcrumbs.value).toEqual([])
  })

  it('navigates to next modal and calls blurActiveElement', () => {
    const blurActiveElement = vi.fn()
    const store = createMenuModalsStoreModel({ blurActiveElement })

    store.nextModal(MenuModals.TRANSLATE, { text: 'hello' })

    expect(blurActiveElement).toHaveBeenCalled()
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

    expect(store.updateStep(lower, MenuModals.INSERT, { text: 'b' })).toBe(true)
    expect(
      store.updateStep(upper, MenuModals.INSERT, { correcting: false })
    ).toBe(true)
    expect(store.currentModalParams.value).toEqual({ correcting: false })
    expect(store.currentStepId.value).toBe(upper)

    store.back()
    expect(store.currentModalParams.value).toEqual({ text: 'b' })
    expect(store.hasStep(upper)).toBe(false)
    expect(store.updateStep(upper, MenuModals.INSERT, { text: 'c' })).toBe(
      false
    )
  })
  it('rejects patches for a different modal without changing its params', () => {
    const store = createMenuModalsStoreModel()
    const id = store.nextModal(MenuModals.DIFF, {
      oldText: 'before',
      newText: 'after',
    })
    expect(
      store.updateStep(id, MenuModals.PREVIEW, { text: 'unexpected' })
    ).toBe(false)
    expect(store.currentModalParams.value).toEqual({
      oldText: 'before',
      newText: 'after',
    })
  })

  it('requires parameters that match the modal contract', () => {
    const store = createMenuModalsStoreModel()
    const checkContracts = () => {
      // @ts-expect-error Diff dialogs require both texts.
      store.nextModal(MenuModals.DIFF)
      // @ts-expect-error Preview dialogs require text.
      store.nextModal(MenuModals.PREVIEW, {})
      // @ts-expect-error Callbacks must have the declared parameter type.
      store.nextModal(MenuModals.ACTION_SELECT, {
        onSelect: (id: number) => id,
      })
      // @ts-expect-error Diff patches cannot introduce an AI task.
      store.updateStep(1, MenuModals.DIFF, { taskId: 'task' })
      // @ts-expect-error NONE is the empty state, not a dialog.
      store.nextModal(MenuModals.NONE)
    }
    void checkContracts
  })

  it('keeps a new operation when stale cleanup or progress arrives', () => {
    const store = createMenuModalsStoreModel()
    const first = store.setPendingModal({ label: 'first' })
    store.cancelPending()
    store.setPendingModal({ label: 'late' }, first)
    expect(store.pendingModal.value).toBeNull()
    const second = store.setPendingModal({ label: 'second' })
    store.clearPendingModal(first)
    store.setPendingModal({ label: 'late' }, first)
    expect(store.pendingModal.value).toEqual({ label: 'second' })
    store.clearPendingModal(second)
    expect(store.pendingModal.value).toBeNull()
  })
})

describe('modal visibility and cancellation', () => {
  it('keeps pending work running when only its UI is closed', () => {
    const store = createMenuModalsStoreModel()
    const onCancel = vi.fn()
    store.setPendingModal({ onCancel })
    store.closeAll()
    expect(onCancel).not.toHaveBeenCalled()
    expect(store.pendingModal.value).toBeNull()
  })

  it('explicitly cancels and closes once', () => {
    const store = createMenuModalsStoreModel()
    const onCancel = vi.fn()
    const onLeave = vi.fn()
    store.nextModal(MenuModals.INSERT, { onLeave })
    store.setPendingModal({ onCancel })
    store.cancelAndCloseAll()
    store.cancelAndCloseAll()
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onLeave).toHaveBeenCalledOnce()
    expect(store.steps.value).toEqual([])
  })
})
