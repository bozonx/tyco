import {
  DEFAULT_DESKTOP_VIEW_STATE,
  desktopViewToSnapshot,
  DESKTOP_COMMANDS,
} from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'

import { createIpcStoreModel, type IpcStoreDeps } from './ipc-store'

function createDeps(overrides: Partial<IpcStoreDeps> = {}): IpcStoreDeps {
  const invokeMock: IpcStoreDeps['desktopClient']['invoke'] = vi.fn(
    async () => ({ success: true, result: ['ok'] })
  ) as IpcStoreDeps['desktopClient']['invoke']

  return {
    desktopClient: {
      invoke: invokeMock,
      getDesktopViewState: vi.fn(() => DEFAULT_DESKTOP_VIEW_STATE),
      isAvailable: () => true,
    },
    notifyError: vi.fn(),
    logError: vi.fn(),
    ...overrides,
  }
}

describe('ipc-store', () => {
  it('binds quick dismissal and input regions to their activation', async () => {
    const deps = createDeps()
    const store = createIpcStoreModel(deps)
    await store.callFunction('dismissQuickWindow')
    expect(deps.desktopClient.invoke).toHaveBeenCalledWith(
      DESKTOP_COMMANDS.DISMISS_QUICK_WINDOW,
      { activationId: DEFAULT_DESKTOP_VIEW_STATE.activationId }
    )
    const region = { x: 0, y: 400, width: 800, height: 100 }
    await store.callFunction('setQuickInputRegion', [region])
    expect(deps.desktopClient.invoke).toHaveBeenCalledWith(
      DESKTOP_COMMANDS.SET_QUICK_INPUT_REGION,
      { region, activationId: DEFAULT_DESKTOP_VIEW_STATE.activationId }
    )
  })
  it('maps a function name to desktop command invocation', async () => {
    const deps = createDeps()
    const store = createIpcStoreModel(deps)

    await store.callFunction('setEditorHistoryResult', ['id-1', 'abc'])

    expect(deps.desktopClient.invoke).toHaveBeenCalledWith(
      DESKTOP_COMMANDS.SET_EDITOR_HISTORY_RESULT,
      { id: 'id-1', result: 'abc' }
    )
  })

  it('maps storage info command', async () => {
    const deps = createDeps()
    const store = createIpcStoreModel(deps)

    await store.callFunction('getStorageInfo')

    expect(deps.desktopClient.invoke).toHaveBeenCalledWith(
      DESKTOP_COMMANDS.GET_STORAGE_INFO,
      undefined
    )
  })

  it('maps the system hotkey configuration command', async () => {
    const deps = createDeps()
    const store = createIpcStoreModel(deps)

    await store.callFunction('configureHotkeys')

    expect(deps.desktopClient.invoke).toHaveBeenCalledWith(
      DESKTOP_COMMANDS.CONFIGURE_HOTKEYS,
      undefined
    )
  })

  it('maps the hotkey rebinding command', async () => {
    const deps = createDeps()
    const store = createIpcStoreModel(deps)

    await store.callFunction('rebindHotkeys')

    expect(deps.desktopClient.invoke).toHaveBeenCalledWith(
      DESKTOP_COMMANDS.REBIND_HOTKEYS,
      undefined
    )
  })

  it('maps the hotkey provider info command', async () => {
    const deps = createDeps()
    const store = createIpcStoreModel(deps)

    await store.callFunction('getHotkeyProviderInfo')

    expect(deps.desktopClient.invoke).toHaveBeenCalledWith(
      DESKTOP_COMMANDS.GET_HOTKEY_PROVIDER_INFO,
      undefined
    )
  })

  it('maps a transfer to the decorated editor window', async () => {
    const deps = createDeps()
    const store = createIpcStoreModel(deps)

    await store.callFunction('openMainEditor', ['result', 'source'])

    expect(deps.desktopClient.invoke).toHaveBeenCalledWith(
      DESKTOP_COMMANDS.OPEN_MAIN_EDITOR,
      {
        text: 'result',
        sourceText: 'source',
        activationId: DEFAULT_DESKTOP_VIEW_STATE.activationId,
      }
    )
  })

  it('binds a voice handoff to the activation that produced its question', async () => {
    const deps = createDeps()
    const store = createIpcStoreModel(deps)
    await store.callFunction('openMainChat', [undefined, 'Question', true])
    expect(deps.desktopClient.invoke).toHaveBeenCalledWith(
      DESKTOP_COMMANDS.OPEN_MAIN_CHAT,
      {
        attachment: undefined,
        question: 'Question',
        autoSend: true,
        activationId: DEFAULT_DESKTOP_VIEW_STATE.activationId,
      }
    )
  })

  it('maps the activate mode command', async () => {
    const deps = createDeps()
    const store = createIpcStoreModel(deps)

    await store.callFunction('activateMode', ['aiTasks', 'sample text'])

    expect(deps.desktopClient.invoke).toHaveBeenCalledWith(
      DESKTOP_COMMANDS.ACTIVATE_MODE,
      { mode: 'aiTasks', text: 'sample text' }
    )
  })

  it('waits for released keys before inserting into a window', async () => {
    const order: string[] = []
    const deps = createDeps({
      waitForKeysReleased: vi.fn(async () => {
        order.push('released')
      }),
    })
    vi.mocked(deps.desktopClient.invoke).mockImplementation(async () => {
      order.push('invoked')
      return { success: true, result: undefined }
    })
    const store = createIpcStoreModel(deps)

    await store.callFunction('pasteIntoTargetAndHide', ['text'])
    await store.callFunction('copyText', ['text'])

    expect(order).toEqual(['released', 'invoked', 'invoked'])
    expect(deps.desktopClient.invoke).toHaveBeenCalledWith(
      DESKTOP_COMMANDS.PASTE_INTO_TARGET_AND_HIDE,
      { text: 'text', activationId: 0 }
    )
  })

  it('maps the save note command', async () => {
    const deps = createDeps()
    const store = createIpcStoreModel(deps)

    await store.callFunction('saveNote', ['/notes', 'note.md', 'text'])

    expect(deps.desktopClient.invoke).toHaveBeenCalledWith(
      DESKTOP_COMMANDS.SAVE_NOTE,
      { dir: '/notes', fileName: 'note.md', text: 'text' }
    )
  })

  it('maps the append note command', async () => {
    const deps = createDeps()
    const store = createIpcStoreModel(deps)

    await store.callFunction('appendNote', ['/notes', 'daily.md', 'entry'])

    expect(deps.desktopClient.invoke).toHaveBeenCalledWith(
      DESKTOP_COMMANDS.APPEND_NOTE,
      { dir: '/notes', fileName: 'daily.md', text: 'entry' }
    )
  })

  it('returns an error for unknown function names', async () => {
    const deps = createDeps()
    const store = createIpcStoreModel(deps)

    // untyped callers, e.g. plugins, may pass any name
    const result = await store.callFunction(
      'unknownMethod' as 'getEditorHistory'
    )

    expect(result).toEqual({
      success: false,
      error: 'Unknown desktop function: unknownMethod',
    })
  })

  it('falls back to local init desktopState without the desktop runtime', async () => {
    const deps = createDeps({
      desktopClient: {
        invoke: vi.fn(),
        getDesktopViewState: vi.fn(() => ({
          ...DEFAULT_DESKTOP_VIEW_STATE,
          windowId: 'fallback-window',
        })),
        isAvailable: () => false,
      },
    })
    const store = createIpcStoreModel(deps)

    const result = await store.loadDesktopState()

    expect(result.windowId).toBe('fallback-window')
    expect(store.desktopState.value.windowId).toBe('fallback-window')
    expect(deps.desktopClient.invoke).not.toHaveBeenCalled()
  })

  it('fails loudly when the desktop runtime cannot give the desktopState', async () => {
    const deps = createDeps({
      desktopClient: {
        invoke: vi.fn(async () => ({
          success: false as const,
          error: 'failed',
        })),
        getDesktopViewState: vi.fn(() => DEFAULT_DESKTOP_VIEW_STATE),
        isAvailable: () => true,
      },
    })
    const store = createIpcStoreModel(deps)

    await expect(store.loadDesktopState()).rejects.toThrow('failed')
    expect(deps.notifyError).toHaveBeenCalled()
    // the defaults must not overwrite the config of the user
    await expect(
      store.saveUserConfig(DEFAULT_DESKTOP_VIEW_STATE.userConfig)
    ).resolves.toMatchObject({ success: false })
    expect(deps.desktopClient.invoke).toHaveBeenCalledTimes(1)
  })

  it('logs thrown invocation errors and returns a failure', async () => {
    const deps = createDeps({
      desktopClient: {
        invoke: vi.fn(async () => {
          throw new Error('boom')
        }),
        getDesktopViewState: vi.fn(() => DEFAULT_DESKTOP_VIEW_STATE),
        isAvailable: () => true,
      },
    })
    const store = createIpcStoreModel(deps)

    const result = await store.callFunction('getEditorHistory')

    expect(result).toEqual({ success: false as const, error: 'Error: boom' })
    expect(deps.logError).toHaveBeenCalled()
    expect(deps.notifyError).not.toHaveBeenCalled()
  })

  it('notifies about a failure when asked to', async () => {
    const deps = createDeps({
      desktopClient: {
        invoke: vi.fn(async () => ({
          success: false as const,
          error: 'no xdotool',
        })),
        getDesktopViewState: vi.fn(() => DEFAULT_DESKTOP_VIEW_STATE),
        isAvailable: () => true,
      },
      errorTitle: () => 'Action failed',
    })
    const store = createIpcStoreModel(deps)

    const result = await store.callFunctionOrNotify('pasteIntoTargetAndHide', [
      'text',
    ])

    expect(result.success).toBe(false)
    expect(deps.notifyError).toHaveBeenCalledWith('no xdotool', 'Action failed')
  })

  describe('after the desktopState are loaded', () => {
    const loadedStore = async (
      invoke: (command: string) => Promise<unknown>
    ) => {
      const deps = createDeps({
        desktopClient: {
          invoke: vi.fn(async (command: string, _args?: unknown) =>
            command === DESKTOP_COMMANDS.GET_DESKTOP_STATE
              ? {
                  success: true,
                  result: desktopViewToSnapshot(
                    structuredClone(DEFAULT_DESKTOP_VIEW_STATE)
                  ),
                }
              : invoke(command)
          ) as IpcStoreDeps['desktopClient']['invoke'],
          getDesktopViewState: vi.fn(() => DEFAULT_DESKTOP_VIEW_STATE),
          isAvailable: () => true,
        },
      })
      const store = createIpcStoreModel(deps)
      await store.loadDesktopState()
      return { deps, store }
    }

    it('applies the saved authoritative snapshot', async () => {
      const nextConfig = {
        ...DEFAULT_DESKTOP_VIEW_STATE.userConfig,
        theme: 'dark' as const,
      }
      const snapshot = desktopViewToSnapshot({
        ...DEFAULT_DESKTOP_VIEW_STATE,
        revision: 1,
        userConfig: nextConfig,
      })
      const { store } = await loadedStore(async () => ({
        success: true,
        result: snapshot,
      }))
      expect((await store.saveUserConfig(nextConfig)).success).toBe(true)
      expect(store.desktopState.value.userConfig).toEqual(nextConfig)
    })
  })
})

it('keeps the invoking activation while waiting for held keys to release', async () => {
  let release!: () => void
  const deps = createDeps({
    waitForKeysReleased: () =>
      new Promise((resolve) => {
        release = resolve
      }),
  })
  const store = createIpcStoreModel(deps)
  store.applyViewState({
    ...DEFAULT_DESKTOP_VIEW_STATE,
    revision: 1,
    activationId: 10,
  })
  const pending = store.callFunction('pasteIntoTargetAndHide', ['Result'])
  store.applyViewState({
    ...DEFAULT_DESKTOP_VIEW_STATE,
    revision: 2,
    activationId: 11,
  })
  release()
  await pending
  expect(deps.desktopClient.invoke).toHaveBeenCalledWith(
    DESKTOP_COMMANDS.PASTE_INTO_TARGET_AND_HIDE,
    { text: 'Result', activationId: 10 }
  )
})
