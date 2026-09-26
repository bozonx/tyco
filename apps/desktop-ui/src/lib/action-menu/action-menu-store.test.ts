import { describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'

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

  it('updates reactive menus and replaces duplicate registrations', async () => {
    const { store } = setup()
    const slots = computed(() => store.getShortcutActions())
    expect(slots.value).toHaveLength(6)
    const original = { id: 'Search:search', preferredKey: 'v', action: vi.fn() }
    const replacement = { ...original, action: vi.fn() }
    store.registerActionsItems([original])
    expect(slots.value[13]).toBe(original)
    store.registerActionsItems([replacement])
    await slots.value[13]?.action('menu text')
    expect(replacement.action).toHaveBeenCalledWith('menu text')
    expect(original.action).not.toHaveBeenCalled()
    expect(store.getRegisteredActions()).toHaveLength(1)
    store.clearRegisteredActions()
    expect(slots.value).toHaveLength(6)
  })

  it('restores saved plugin positions after disabling and re-enabling', () => {
    const { deps } = setup()
    const store = createActionMenuStoreModel({
      ...deps,
      mainActions: () => [null, { type: 'plugin', actionId: 'Notes:create' }],
      mainActionRegistrations: () => ['Notes:create'],
    })
    const action = { id: 'Notes:create', preferredKey: 'c', action: vi.fn() }
    store.registerActionsItems([action])
    expect(store.getShortcutActions()).toEqual([undefined, action])
    store.clearRegisteredActions()
    expect(store.getActionsMenu()).toEqual([])
    store.registerActionsItems([action])
    expect(store.getShortcutActions()).toEqual([undefined, action])
  })

  it('maps configured actions to their shortcut slots', () => {
    const mainActions = [
      null,
      { type: 'standard' as const, actionId: 'translation' as const },
      { type: 'standard' as const, actionId: 'copyToClipboard' as const },
    ]
    const deps = {
      typeIntoWindowAndClose: vi.fn(),
      putIntoClipboardAndClose: vi.fn().mockResolvedValue(undefined),
      saveOutput: vi.fn().mockResolvedValue(undefined),
      openAiTaskModal: vi.fn(),
      openTranslateModal: vi.fn(),
      startCorrection: vi.fn().mockResolvedValue(undefined),
      startChatWithAttachment: vi.fn(),
      showToast: vi.fn(),
      mainActions: () => mainActions,
    }
    const store = createActionMenuStoreModel(deps)

    expect(store.getShortcutActions().map((action) => action?.id)).toEqual([
      undefined,
      'translation',
      'copyToClipboard',
    ])
    expect(store.getActionsMenu().map((action) => action.id)).toEqual([
      'translation',
      'copyToClipboard',
    ])
  })
})
