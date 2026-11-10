import { describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { DEFAULT_MAIN_ACTIONS } from '@tyco/shared'

import { createCommand } from '../commands/command-config'
import { createCoreTools } from '../tools/core-tools'
import { testTools } from '../tools/testing'
import { createActionMenuModel } from './action-menu-model'

/** The core tools the built-in actions run, over mocks of what the app does */
function coreTools() {
  const services = {
    insertText: vi.fn(async (_text: string) => {}),
    copyText: vi.fn(async (_text: string) => {}),
    askInChat: vi.fn(async (_text: string) => {}),
  }
  const tools = testTools(
    {},
    createCoreTools({
      ...services,
      correctText: vi.fn(),
      translateTo: vi.fn(),
      transformationPrompt: vi.fn(),
      stylingPrompt: vi.fn(),
      getLlmUnavailableReasonKey: () => undefined,
      getTranslatorUnavailableReasonKey: () => undefined,
      describeError: String,
    })
  )
  return { services, tools }
}

describe('createActionMenuModel', () => {
  const setup = () => {
    const { services, tools } = coreTools()
    const deps = {
      saveOutput: vi.fn().mockResolvedValue(undefined),
      openTranslateModal: vi.fn(),
      openTransformationModal: vi.fn(),
      openQuickAiRequestModal: vi.fn(),
      openStylingModal: vi.fn(),
      openChatPromptsModal: vi.fn(),
      openFavoritesModal: vi.fn(),
      startCorrection: vi.fn().mockResolvedValue(undefined),
      correctAndInsert: vi.fn().mockResolvedValue(undefined),
      showToast: vi.fn(),
      hideWindow: vi.fn(),
      minCorrectionLength: () => 10,
      tools,
    }
    const store = createActionMenuModel(deps)
    return { store, deps, services }
  }

  it('hides development actions without moving other shortcuts or changing saved slots', () => {
    const { deps } = setup()
    const mainActions = {
      q: { type: 'standard' as const, actionId: 'askInChat' as const },
      w: { type: 'standard' as const, actionId: 'correction' as const },
    }
    const store = createActionMenuModel({
      ...deps,
      mainActions: () => mainActions,
      isMainActionVisible: (action) =>
        !(action.type === 'standard' && action.actionId === 'askInChat'),
    })
    expect(store.resolveMainActions().slice(0, 2)).toEqual([
      null,
      mainActions.w,
    ])
    expect(
      store.getDefaultActions().some((action) => action.id === 'askInChat')
    ).toBe(false)
    expect(store.getShortcutActions()[0]).toBeUndefined()
    expect(store.getShortcutActions()[1]?.id).toBe('correction')
    expect(mainActions.q.actionId).toBe('askInChat')
  })

  it('hides the slot of a profile of a vault away without its place', () => {
    const { deps } = setup()
    const mainActions = {
      q: { type: 'profileChat' as const, profileId: 'writer', vaultId: 'w1' },
      w: { type: 'standard' as const, actionId: 'correction' as const },
    }
    let connected: string[] = []
    const store = createActionMenuModel({
      ...deps,
      mainActions: () => mainActions,
      profiles: () => [{ id: 'w1:writer', name: 'Writer' }],
      connectedVaultIds: () => connected,
    })
    expect(store.getShortcutActions()[0]?.id).toBe('correction')
    // the saved slot is kept and comes back with its vault
    expect(mainActions.q.vaultId).toBe('w1')
    connected = ['w1']
    expect(store.getShortcutActions()[0]?.id).toBe('profileChat:w1:writer')
  })

  it('supports multiple action pages and determines takesText per page', () => {
    const { deps } = setup()
    const store = createActionMenuModel({
      ...deps,
      actionPages: () => [
        {
          inputMode: 'selection',
          slots: { q: { type: 'standard', actionId: 'copyToClipboard' } },
        },
        {
          inputMode: 'none',
          slots: { q: { type: 'standard', actionId: 'askInChat' } },
        },
      ],
    })
    expect(store.pageCount.value).toBe(2)
    expect(store.pageIndex.value).toBe(0)
    expect(store.takesText.value).toBe(true)
    expect(store.getShortcutActions()[0]?.id).toBe('copyToClipboard')

    store.nextPage()
    expect(store.pageIndex.value).toBe(1)
    expect(store.takesText.value).toBe(false)
    expect(store.getShortcutActions()[0]?.id).toBe('askInChat')

    store.setPage(0)
    expect(store.pageIndex.value).toBe(0)
    expect(store.takesText.value).toBe(true)
  })

  it('cycles all pages on repeated hotkey presses and jumps to a different page first', () => {
    const { deps } = setup()
    const store = createActionMenuModel({
      ...deps,
      actionPages: () => [
        { inputMode: 'selection', slots: {} },
        { inputMode: 'selection', slots: {} },
        { inputMode: 'selection', slots: {} },
      ],
    })

    // Opened on page 1 (index 0); repeating the page 1 hotkey cycles 1 -> 2 -> 0 -> 1
    store.openPage(0)
    expect(store.pageIndex.value).toBe(0)
    const seenFromFirst: number[] = []
    for (let i = 0; i < 4; i++) {
      store.repeatOpenPage(0)
      seenFromFirst.push(store.pageIndex.value)
    }
    expect(seenFromFirst).toEqual([1, 2, 0, 1])

    // Opened on page 2 (index 1); repeating the page 2 hotkey also cycles all pages
    store.openPage(1)
    expect(store.pageIndex.value).toBe(1)
    const seenFromSecond: number[] = []
    for (let i = 0; i < 4; i++) {
      store.repeatOpenPage(1)
      seenFromSecond.push(store.pageIndex.value)
    }
    expect(seenFromSecond).toEqual([2, 0, 1, 2])

    // Pressing a different page hotkey jumps to that page first, then cycles on repeat
    store.openPage(0)
    store.repeatOpenPage(2)
    expect(store.pageIndex.value).toBe(2)
    store.repeatOpenPage(2)
    expect(store.pageIndex.value).toBe(0)

    // Pressing a different page hotkey whose page is already shown steps forward instead of staying put
    store.openPage(0)
    store.setPage(1)
    store.repeatOpenPage(1)
    expect(store.pageIndex.value).toBe(2)
  })

  it('corrects and inserts directly only for sufficiently long text', async () => {
    const { store, deps } = setup()
    await store.runDefaultAction('directCorrection', '')
    await store.runDefaultAction('directCorrection', 'short')
    expect(deps.correctAndInsert).not.toHaveBeenCalled()
    expect(deps.showToast).toHaveBeenCalledWith(
      'toast.textNotSelected',
      'error'
    )
    expect(deps.showToast).toHaveBeenCalledWith(
      'toast.textTooShortForCorrection',
      'warn'
    )
    await store.runDefaultAction('directCorrection', 'Text to correct')
    expect(deps.correctAndInsert).toHaveBeenCalledWith('Text to correct')
    expect(deps.startCorrection).not.toHaveBeenCalled()
  })

  it('shows toast when attempting actions on empty text', async () => {
    const { store, deps, services } = setup()
    const actions = store.getDefaultActions()

    const insertAction = actions.find(
      (a) => a.labelKey === 'action.insertIntoWindow'
    )
    await insertAction?.action('   ')

    expect(deps.showToast).toHaveBeenCalledWith(
      'toast.textNotSelected',
      'error'
    )
    expect(services.insertText).not.toHaveBeenCalled()
    expect(deps.saveOutput).not.toHaveBeenCalled()
  })

  it('triggers insert action when valid text provided', async () => {
    const { store, services } = setup()
    const actions = store.getDefaultActions()

    const insertAction = actions.find(
      (a) => a.labelKey === 'action.insertIntoWindow'
    )
    await insertAction?.action('some text to insert')

    expect(services.insertText).toHaveBeenCalledWith('some text to insert')
  })

  it('copies the text and closes the window without a saved command', async () => {
    const { store, deps, services } = setup()
    await store
      .getDefaultActions()
      .find((a) => a.id === 'copyToClipboard')
      ?.action('copied')

    expect(services.copyText).toHaveBeenCalledWith('copied')
    expect(deps.showToast).toHaveBeenCalledWith('common.copied', 'success')
    expect(deps.hideWindow).toHaveBeenCalled()
  })

  it('triggers transformation and styling modals when valid text provided', async () => {
    const { store, deps } = setup()
    const actions = store.getDefaultActions()

    const transformation = actions.find((a) => a.id === 'transformationMenu')
    await transformation?.action('some text to transform')
    expect(deps.openTransformationModal).toHaveBeenCalledWith(
      'some text to transform'
    )

    const customTransformation = actions.find((a) => a.id === 'quickAiRequest')
    await customTransformation?.action('some text for custom query')
    expect(deps.openQuickAiRequestModal).toHaveBeenCalledWith(
      'some text for custom query',
      'text'
    )

    const voiceTransformation = actions.find(
      (a) => a.id === 'voiceQuickAiRequest'
    )
    await voiceTransformation?.action('some text for voice query')
    expect(deps.openQuickAiRequestModal).toHaveBeenCalledWith(
      'some text for voice query',
      'voice'
    )

    const styling = actions.find((a) => a.id === 'stylingMenu')
    await styling?.action('some text to restyle')
    expect(deps.openStylingModal).toHaveBeenCalledWith('some text to restyle')

    const chatPrompts = actions.find((a) => a.id === 'chatPromptsMenu')
    await chatPrompts?.action('some text for chat prompt')
    expect(deps.openChatPromptsModal).toHaveBeenCalledWith(
      'some text for chat prompt'
    )

    const favorites = actions.find((a) => a.id === 'favoritesMenu')
    await favorites?.action('')
    expect(deps.openFavoritesModal).toHaveBeenCalled()
  })

  it('saves the text to history before it leaves the app', async () => {
    const { store, deps, services } = setup()
    const order: string[] = []
    deps.saveOutput.mockImplementation(async () => {
      order.push('save')
    })
    services.insertText.mockImplementation(async () => {
      order.push('insert')
    })
    services.copyText.mockImplementation(async () => {
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

  it('passes step params to a correction of a long enough text', async () => {
    const { store, deps } = setup()
    const text = 'a text that is long enough to be corrected'

    await store.correct('short', { insertOnly: true })
    expect(deps.startCorrection).not.toHaveBeenCalled()

    await store.correct(text, { insertOnly: true })
    expect(deps.startCorrection).toHaveBeenCalledWith(text, {
      insertOnly: true,
    })
  })

  it('opens the chat with or without text for askInChat action', async () => {
    const { store, deps, services } = setup()
    const actions = store.getDefaultActions()

    const askInChatAction = actions.find(
      (a) => a.labelKey === 'action.askInChat'
    )
    await askInChatAction?.action('   ')
    expect(services.askInChat).toHaveBeenCalledWith('   ')
    expect(deps.showToast).not.toHaveBeenCalled()

    await askInChatAction?.action('some context text')
    expect(services.askInChat).toHaveBeenCalledWith('some context text')
    expect(deps.saveOutput).not.toHaveBeenCalled()
  })

  it('allows registering custom action items', () => {
    const { store } = setup()

    const customAction = { name: 'custom', action: vi.fn() }
    store.registerActionsItems([customAction])

    const allActions = store.getActionsMenu()
    expect(allActions).toContain(customAction)
  })

  it('allows disposing registered action items', () => {
    const { store } = setup()

    const initialCount = store.getActionsMenu().length
    const customAction = { name: 'custom', action: vi.fn() }
    const dispose = store.registerActionsItems([customAction])
    expect(store.getActionsMenu()).toContain(customAction)

    dispose()
    expect(store.getActionsMenu()).not.toContain(customAction)
    expect(store.getActionsMenu()).toHaveLength(initialCount)
  })

  it('updates reactive menus and replaces duplicate registrations', async () => {
    const { deps } = setup()
    const store = createActionMenuModel({
      ...deps,
      mainActions: () => ({
        ...DEFAULT_MAIN_ACTIONS,
        v: { type: 'plugin', actionId: 'Search:search' },
      }),
    })
    const slots = computed(() => store.getShortcutActions())
    expect(slots.value).toHaveLength(11)
    const original = { id: 'Search:search', action: vi.fn() }
    const replacement = { ...original, action: vi.fn() }
    store.registerActionsItems([original])
    expect(slots.value[13]).toBe(original)
    const dispose = store.registerActionsItems([replacement])
    await slots.value[13]?.action('menu text')
    expect(replacement.action).toHaveBeenCalledWith('menu text')
    expect(original.action).not.toHaveBeenCalled()
    expect(store.getRegisteredActions()).toHaveLength(1)
    dispose()
    expect(slots.value).toHaveLength(11)
  })

  it('places plugin actions only where the menu holds them', () => {
    const { store } = setup()
    store.registerActionsItems([{ id: 'Search:search', action: vi.fn() }])
    expect(store.getShortcutActions()).toHaveLength(14)
  })

  it('restores saved plugin positions after disabling and re-enabling', () => {
    const { deps } = setup()
    const store = createActionMenuModel({
      ...deps,
      mainActions: () => ({ w: { type: 'plugin', actionId: 'Notes:create' } }),
    })
    const action = { id: 'Notes:create', action: vi.fn() }
    const dispose = store.registerActionsItems([action])
    expect(store.getShortcutActions()).toEqual([undefined, action])
    dispose()
    expect(store.getActionsMenu()).toEqual([])
    store.registerActionsItems([action])
    expect(store.getShortcutActions()).toEqual([undefined, action])
  })

  it('maps configured actions to their shortcut slots', () => {
    const mainActions = {
      w: { type: 'standard' as const, actionId: 'translationMenu' as const },
      e: { type: 'standard' as const, actionId: 'copyToClipboard' as const },
    }
    const deps = {
      saveOutput: vi.fn().mockResolvedValue(undefined),
      openTranslateModal: vi.fn(),
      startCorrection: vi.fn().mockResolvedValue(undefined),
      correctAndInsert: vi.fn().mockResolvedValue(undefined),
      showToast: vi.fn(),
      mainActions: () => mainActions,
      tools: testTools(),
    }
    const store = createActionMenuModel(deps)

    expect(store.getShortcutActions().map((action) => action?.id)).toEqual([
      undefined,
      'translationMenu',
      'copyToClipboard',
    ])
    expect(store.getActionsMenu().map((action) => action.id)).toEqual([
      'translationMenu',
      'copyToClipboard',
    ])
  })

  it('builds the items of commands that take no text in their slots', async () => {
    const { deps } = setup()
    const noText = {
      ...createCommand('script', 'sc1'),
      name: 'Backup',
      toolConfig: { command: 'backup' },
    }
    const executeScriptAction = vi
      .fn()
      .mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: '',
        stderr: '',
        running: false,
      })
    const store = createActionMenuModel({
      ...deps,
      tools: testTools({ executeScriptAction }),
      mainActions: () => ({ q: { type: 'command', commandId: 'sc1' } }),
      commands: () => [noText],
    })

    const [item] = store.getShortcutActions()
    expect(item?.id).toBe('command:sc1')
    expect(store.getActionsMenu()).toHaveLength(1)

    await item?.action('editor text')
    // the text does not leave the app with a command that takes none
    expect(deps.saveOutput).not.toHaveBeenCalled()
    expect(executeScriptAction.mock.calls[0][0]).toMatchObject({ text: '' })
  })

  it('builds the items of enabled commands, in their slots', async () => {
    const { deps } = setup()
    const script = {
      ...createCommand('script', 'sc1'),
      name: 'Echo',
      toolConfig: { command: 'echo {{TEXT}}' },
    }
    const noText = {
      ...createCommand('webhook', 'wh1'),
      toolConfig: { url: 'https://x.test' },
    }
    const disabled = { ...createCommand('script', 'sc2'), isEnabled: false }
    const executeScriptAction = vi
      .fn()
      .mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: '',
        stderr: '',
        running: false,
      })
    const store = createActionMenuModel({
      ...deps,
      tools: testTools({ executeScriptAction }),
      mainActions: () => ({
        q: { type: 'command', commandId: 'sc1' },
        w: { type: 'command', commandId: 'wh1' },
        e: { type: 'command', commandId: 'sc2' },
        r: { type: 'command', commandId: 'missing' },
        t: { type: 'standard', actionId: 'translationMenu' },
      }),
      commands: () => [script, noText, disabled],
    })

    const slots = store.getShortcutActions()
    expect(slots.map((action) => action?.id)).toEqual([
      'command:sc1',
      'command:wh1',
      undefined,
      undefined,
      'translationMenu',
    ])
    expect(slots[0]).toMatchObject({ name: 'Echo', icon: 'mdi:console-line' })

    await slots[0]?.action('menu text')
    expect(deps.saveOutput).toHaveBeenCalledWith('menu text')
    expect(executeScriptAction.mock.calls[0][0]).toMatchObject({
      commandId: 'sc1',
      text: 'menu text',
    })
  })

  it('shows and clears pending modal while a command action runs and aborts on cancel', async () => {
    const { deps } = setup()
    const script = {
      ...createCommand('script', 'sc1'),
      name: 'Echo',
      toolConfig: { command: 'echo {{TEXT}}' },
    }
    const setPendingModal = vi.fn().mockReturnValue(7)
    const clearPendingModal = vi.fn()
    const cancelScriptAction = vi.fn().mockResolvedValue(undefined)
    const executeScriptAction = vi.fn().mockImplementation(async () => {
      const pending = setPendingModal.mock.calls[0]?.[0]
      pending?.onCancel?.()
      return {
        success: true,
        exitCode: 0,
        stdout: '',
        stderr: '',
        running: false,
      }
    })
    const store = createActionMenuModel({
      ...deps,
      setPendingModal,
      clearPendingModal,
      tools: testTools({ executeScriptAction, cancelScriptAction }),
      mainActions: () => ({ q: { type: 'command', commandId: 'sc1' } }),
      commands: () => [script],
    })

    const [item] = store.getShortcutActions()
    await item?.action('menu text')

    expect(setPendingModal).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Running “Echo”…',
        onCancel: expect.any(Function),
      })
    )
    expect(cancelScriptAction).toHaveBeenCalledOnce()
    expect(clearPendingModal).toHaveBeenCalledWith(7)
  })

  it('builds the items of transformations and languages, which open their dialog', async () => {
    const { deps } = setup()
    const store = createActionMenuModel({
      ...deps,
      mainActions: () => ({
        q: { type: 'transformation', transformationId: 'shorten' },
        w: { type: 'transformation', transformationId: 'gone' },
        e: { type: 'translation', language: 'en-US' },
      }),
      transformations: () => [{ id: 'shorten', name: 'Shorten' }],
    })

    const slots = store.getShortcutActions()
    expect(slots.map((action) => action?.id)).toEqual([
      'transformation:shorten',
      undefined,
      'translation:en-US',
    ])
    expect(slots[0]).toMatchObject({ name: 'Shorten' })
    expect(slots[2]).toMatchObject({ labelKey: 'language.en-US' })

    await slots[0]?.action('some text')
    expect(deps.openTransformationModal).toHaveBeenCalledWith(
      'some text',
      'shorten'
    )
    await slots[2]?.action('some text')
    expect(deps.openTranslateModal).toHaveBeenCalledWith('some text', 'en-US')

    await slots[2]?.action('  ')
    expect(deps.openTranslateModal).toHaveBeenCalledTimes(1)
    expect(deps.showToast).toHaveBeenCalledWith(
      'toast.textNotSelected',
      'error'
    )
  })

  it('runs a prompt of the library in its profile, with or without text', async () => {
    const openChatPrompt = vi.fn()
    const { deps } = setup()
    const store = createActionMenuModel({
      ...deps,
      openChatPrompt,
      profiles: () => [{ id: 'writer', name: 'Writer' }],
      chatPrompts: () => [
        { id: 'fix', name: 'Fix', rule: ' Fix it ', profileId: 'writer' },
        { id: 'lost', name: 'Lost', rule: 'Lost', profileId: 'gone' },
        { id: 'blank', name: 'Blank', rule: ' ', profileId: '' },
      ],
      mainActions: () => ({
        q: { type: 'chatPrompt', promptId: 'fix' },
        w: { type: 'chatPrompt', promptId: 'lost' },
        e: { type: 'chatPrompt', promptId: 'blank' },
        r: { type: 'chatPrompt', promptId: 'deleted' },
      }),
    })
    const slots = store.getShortcutActions()
    expect(slots.map((action) => action?.id)).toEqual([
      'chatPrompt:fix',
      'chatPrompt:lost',
    ])
    await slots[0]?.action('')
    expect(openChatPrompt).toHaveBeenCalledWith('', 'Fix it', 'writer')
    await slots[1]?.action('text')
    expect(openChatPrompt).toHaveBeenLastCalledWith('text', 'Lost', null)
  })

  it('opens profile chat with text for profileChat action', async () => {
    const openProfileChat = vi.fn()
    const { deps } = setup()
    const store = createActionMenuModel({
      ...deps,
      profiles: () => [{ id: 'writer', name: 'Writer' }],
      openProfileChat,
      mainActions: () => ({ q: { type: 'profileChat', profileId: 'writer' } }),
    })
    const [action] = store.getShortcutActions()
    expect(action?.name).toBe('Ask in chat: Writer')
    await action?.action('text for writer')
    expect(openProfileChat).toHaveBeenCalledWith('writer', 'text for writer')
  })

  it('resolves individual action items with resolveActionItem', () => {
    const { deps } = setup()
    const model = createActionMenuModel(deps)

    const copyItem = model.resolveActionItem({
      type: 'standard',
      actionId: 'copyToClipboard',
    })
    expect(copyItem).toBeDefined()
    expect(copyItem?.id).toBe('copyToClipboard')

    const pageItem = model.resolveActionItem({
      type: 'actionPage',
      pageIndex: 1,
    })
    expect(pageItem).toBeDefined()
    expect(pageItem?.id).toBe('actionPage:1')

    expect(model.resolveActionItem(null)).toBeUndefined()
  })

  it('creates and executes actionPage actions', async () => {
    const openActionPage = vi.fn()
    const { deps } = setup()
    const store = createActionMenuModel({
      ...deps,
      actionPages: () => [
        {
          inputMode: 'selection',
          slots: { q: { type: 'actionPage', pageIndex: 1 } },
        },
        { inputMode: 'none', slots: {} },
      ],
      openActionPage,
    })

    const slots = store.getShortcutActions()
    expect(slots[0]?.id).toBe('actionPage:1')
    await slots[0]?.action('hello')
    expect(openActionPage).toHaveBeenCalledWith(1, 'hello')
  })

  it('creates and executes all profile action kinds', async () => {
    const openProfileChat = vi.fn()
    const openQuickAiRequestModal = vi.fn()
    const activateMode = vi.fn()
    const { deps } = setup()
    const store = createActionMenuModel({
      ...deps,
      profiles: () => [{ id: 'writer', name: 'Writer' }],
      openProfileChat,
      openQuickAiRequestModal,
      activateMode,
      mainActions: () => ({
        q: { type: 'profile', profileId: 'writer', action: 'quickAiRequest' },
        w: {
          type: 'profile',
          profileId: 'writer',
          action: 'voiceQuickAiRequest',
        },
        e: {
          type: 'profile',
          profileId: 'writer',
          action: 'screenshotQuickAiRequest',
        },
        r: {
          type: 'profile',
          profileId: 'writer',
          action: 'voiceScreenshotQuickAiRequest',
        },
        t: { type: 'profile', profileId: 'writer', action: 'chat' },
      }),
    })
    const slots = store.getShortcutActions()
    expect(slots[0]?.name).toContain('Writer')
    await slots[0]?.action('hello')
    expect(openQuickAiRequestModal).toHaveBeenCalledWith(
      'hello',
      'text',
      'writer'
    )

    await slots[1]?.action('hello voice')
    expect(openQuickAiRequestModal).toHaveBeenCalledWith(
      'hello voice',
      'voice',
      'writer'
    )

    await slots[2]?.action('')
    expect(activateMode).toHaveBeenCalledWith(
      'screenshotQuickAiRequest',
      'writer'
    )

    await slots[3]?.action('')
    expect(activateMode).toHaveBeenCalledWith(
      'voiceScreenshotQuickAiRequest',
      'writer'
    )

    await slots[4]?.action('chat text')
    expect(openProfileChat).toHaveBeenCalledWith('writer', 'chat text')
  })
})
