import { describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'

import { createCommand } from '../commands/command-config'
import { createCoreTools } from '../tools/core-tools'
import { testTools } from '../tools/testing'
import { createActionMenuModel } from './action-menu-store'

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
      aiCustomPrompt: vi.fn(),
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
      openAiTaskModal: vi.fn(),
      openTranslateModal: vi.fn(),
      startCorrection: vi.fn().mockResolvedValue(undefined),
      showToast: vi.fn(),
      hideWindow: vi.fn(),
      minCorrectionLength: () => 10,
      tools,
    }
    const store = createActionMenuModel(deps)
    return { store, deps, services }
  }

  it('opens command pages beyond the global shortcut range with the current text', async () => {
    const { deps } = setup()
    const openLauncherPage = vi.fn(async () => {})
    const store = createActionMenuModel({
      ...deps,
      openLauncherPage,
      mainActions: () => [{ type: 'launcherPage', page: 12 }],
    })
    await store.getShortcutActions()[0]?.action('current text')
    expect(openLauncherPage).toHaveBeenCalledWith(12, 'current text')
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
    expect(deps.showToast).toHaveBeenCalledWith('toast.copied', 'success')
    expect(deps.hideWindow).toHaveBeenCalled()
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

  it('opens the chat with the text for askInChat action', async () => {
    const { store, deps, services } = setup()
    const actions = store.getDefaultActions()

    const askInChatAction = actions.find(
      (a) => a.labelKey === 'action.askInChat'
    )
    await askInChatAction?.action('   ')
    expect(deps.showToast).toHaveBeenCalledWith(
      'toast.textNotSelected',
      'error'
    )
    expect(services.askInChat).not.toHaveBeenCalled()

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
    const store = createActionMenuModel({
      ...deps,
      mainActions: () => [null, { type: 'plugin', actionId: 'Notes:create' }],
      reviewedMainActionIds: () => ['Notes:create'],
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
      saveOutput: vi.fn().mockResolvedValue(undefined),
      openAiTaskModal: vi.fn(),
      openTranslateModal: vi.fn(),
      startCorrection: vi.fn().mockResolvedValue(undefined),
      showToast: vi.fn(),
      mainActions: () => mainActions,
      tools: testTools(),
    }
    const store = createActionMenuModel(deps)

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
      mainActions: () => [{ type: 'command', commandId: 'sc1' }],
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
    const disabled = { ...createCommand('script', 'sc2'), enabled: false }
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
      mainActions: () => [
        { type: 'command', commandId: 'sc1' },
        { type: 'command', commandId: 'wh1' },
        { type: 'command', commandId: 'sc2' },
        { type: 'command', commandId: 'missing' },
        { type: 'standard', actionId: 'translation' },
      ],
      commands: () => [script, noText, disabled],
    })

    const slots = store.getShortcutActions()
    expect(slots.map((action) => action?.id)).toEqual([
      'command:sc1',
      'command:wh1',
      undefined,
      undefined,
      'translation',
    ])
    expect(slots[0]).toMatchObject({ name: 'Echo', icon: 'mdi:console-line' })

    await slots[0]?.action('menu text')
    expect(deps.saveOutput).toHaveBeenCalledWith('menu text')
    expect(executeScriptAction.mock.calls[0][0]).toMatchObject({
      command: 'echo {{TEXT}}',
      text: 'menu text',
    })
  })

  it('builds the items of AI tasks and languages, which open their dialog', async () => {
    const { deps } = setup()
    const store = createActionMenuModel({
      ...deps,
      mainActions: () => [
        { type: 'aiTask', taskId: 'task-2' },
        { type: 'aiTask', taskId: 'gone' },
        { type: 'translation', language: 'en_US' },
      ],
      aiTasks: () => [null, { id: 'task-2', name: 'Shorten' }],
    })

    const slots = store.getShortcutActions()
    expect(slots.map((action) => action?.id)).toEqual([
      'aiTask:task-2',
      undefined,
      'translation:en_US',
    ])
    expect(slots[0]).toMatchObject({ name: 'Shorten' })
    expect(slots[2]).toMatchObject({ labelKey: 'language.en_US' })

    await slots[0]?.action('some text')
    expect(deps.openAiTaskModal).toHaveBeenCalledWith('some text', 'task-2')
    await slots[2]?.action('some text')
    expect(deps.openTranslateModal).toHaveBeenCalledWith('some text', 'en_US')

    await slots[2]?.action('  ')
    expect(deps.openTranslateModal).toHaveBeenCalledTimes(1)
    expect(deps.showToast).toHaveBeenCalledWith(
      'toast.textNotSelected',
      'error'
    )
  })
})
