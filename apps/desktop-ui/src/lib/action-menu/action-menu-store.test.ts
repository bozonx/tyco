import { describe, expect, it, vi } from 'vitest'

import { createActionMenuStoreModel } from './action-menu-store'

describe('createActionMenuStoreModel', () => {
  const setup = () => {
    const deps = {
      typeIntoWindowAndClose: vi.fn(),
      putIntoClipboardAndClose: vi.fn().mockResolvedValue(undefined),
      saveOutput: vi.fn().mockResolvedValue(undefined),
      openAiTaskModal: vi.fn(),
      openTranslateModal: vi.fn(),
      startCorrection: vi.fn().mockResolvedValue(undefined),
      startChatWithAttachment: vi.fn(),
      showToast: vi.fn(),
      minCorrectionLength: () => 10,
    }
    const store = createActionMenuStoreModel(deps)
    return { store, deps }
  }

  it('shows toast when attempting actions on empty text', async () => {
    const { store, deps } = setup()
    const actions = store.getDefaultActions()

    const insertAction = actions.find(
      (a) => a.labelKey === 'action.insertIntoWindow'
    )
    await insertAction?.action('   ')

    expect(deps.showToast).toHaveBeenCalledWith(
      'toast.textNotSelected',
      'error'
    )
    expect(deps.typeIntoWindowAndClose).not.toHaveBeenCalled()
    expect(deps.saveOutput).not.toHaveBeenCalled()
  })

  it('triggers insert action when valid text provided', async () => {
    const { store, deps } = setup()
    const actions = store.getDefaultActions()

    const insertAction = actions.find(
      (a) => a.labelKey === 'action.insertIntoWindow'
    )
    await insertAction?.action('some text to insert')

    expect(deps.typeIntoWindowAndClose).toHaveBeenCalledWith(
      'some text to insert'
    )
  })

  it('saves the text to history before it leaves the app', async () => {
    const { store, deps } = setup()
    const order: string[] = []
    deps.saveOutput.mockImplementation(async () => {
      order.push('save')
    })
    deps.typeIntoWindowAndClose.mockImplementation(() => order.push('insert'))
    deps.putIntoClipboardAndClose.mockImplementation(async () => {
      order.push('copy')
    })
    const actions = store.getDefaultActions()

    await actions
      .find((a) => a.labelKey === 'action.insertIntoWindow')
      ?.action('inserted')
    await actions
      .find((a) => a.labelKey === 'action.copyToClipboard')
      ?.action('copied')

    expect(deps.saveOutput.mock.calls).toEqual([['inserted'], ['copied']])
    expect(order).toEqual(['save', 'insert', 'save', 'copy'])
  })

  it('warns when text is too short for correction', async () => {
    const { store, deps } = setup()
    const actions = store.getDefaultActions()

    const correctionAction = actions.find(
      (a) => a.labelKey === 'action.correction'
    )
    await correctionAction?.action('short')

    expect(deps.showToast).toHaveBeenCalledWith(
      'toast.textTooShortForCorrection',
      'warn'
    )
    expect(deps.startCorrection).not.toHaveBeenCalled()
  })

  it('triggers startChatWithAttachment for askInChat action', async () => {
    const { store, deps } = setup()
    const actions = store.getDefaultActions()

    const askInChatAction = actions.find(
      (a) => a.labelKey === 'action.askInChat'
    )
    await askInChatAction?.action('   ')
    expect(deps.showToast).toHaveBeenCalledWith(
      'toast.textNotSelected',
      'error'
    )
    expect(deps.startChatWithAttachment).not.toHaveBeenCalled()

    await askInChatAction?.action('some context text')
    expect(deps.startChatWithAttachment).toHaveBeenCalledWith(
      'some context text'
    )
  })

  it('allows registering custom action items', () => {
    const { store } = setup()

    const customAction = { name: 'custom', action: vi.fn() }
    store.registerActionsItems([customAction])

    const allActions = store.getActionsMenu()
    expect(allActions).toContain(customAction)
  })

  it('allows clearing registered action items', () => {
    const { store } = setup()

    const customAction = { name: 'custom', action: vi.fn() }
    store.registerActionsItems([customAction])
    expect(store.getActionsMenu()).toContain(customAction)

    store.clearRegisteredActions()
    expect(store.getActionsMenu()).not.toContain(customAction)
    expect(store.getActionsMenu()).toHaveLength(
      store.getDefaultActions().length
    )
  })
})
