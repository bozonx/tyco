import {
  DEFAULT_INIT_PARAMS,
  DESKTOP_COMMANDS,
  START_MODES,
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
      getInitParams: vi.fn(() => DEFAULT_INIT_PARAMS),
      isAvailable: () => true,
    },
    notifyError: vi.fn(),
    logError: vi.fn(),
    ...overrides,
  }
}

describe('ipc-store', () => {
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
      { text: 'result', sourceText: 'source' }
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
      return { success: true }
    })
    const store = createIpcStoreModel(deps)

    await store.callFunction('typeIntoWindowAndClose', ['text'])
    await store.callFunction('putIntoClipboardAndClose', ['text'])

    expect(order).toEqual(['released', 'invoked', 'invoked'])
    expect(deps.desktopClient.invoke).toHaveBeenCalledWith(
      DESKTOP_COMMANDS.TYPE_INTO_WINDOW_AND_CLOSE,
      { text: 'text' }
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

  it('falls back to local init params without the desktop runtime', async () => {
    const deps = createDeps({
      desktopClient: {
        invoke: vi.fn(),
        getInitParams: vi.fn(() => ({
          ...DEFAULT_INIT_PARAMS,
          windowId: 'fallback-window',
        })),
        isAvailable: () => false,
      },
    })
    const store = createIpcStoreModel(deps)

    const result = await store.loadInitialParams()

    expect(result.windowId).toBe('fallback-window')
    expect(store.params.value.windowId).toBe('fallback-window')
    expect(deps.desktopClient.invoke).not.toHaveBeenCalled()
  })

  it('fails loudly when the desktop runtime cannot give the params', async () => {
    const deps = createDeps({
      desktopClient: {
        invoke: vi.fn(async () => ({ success: false, error: 'failed' })),
        getInitParams: vi.fn(() => DEFAULT_INIT_PARAMS),
        isAvailable: () => true,
      },
    })
    const store = createIpcStoreModel(deps)

    await expect(store.loadInitialParams()).rejects.toThrow('failed')
    expect(deps.notifyError).toHaveBeenCalled()
    // the defaults must not overwrite the config of the user
    await expect(
      store.saveUserConfig(DEFAULT_INIT_PARAMS.userConfig)
    ).resolves.toMatchObject({ success: false })
    expect(deps.desktopClient.invoke).toHaveBeenCalledTimes(1)
  })

  it('logs thrown invocation errors and returns a failure', async () => {
    const deps = createDeps({
      desktopClient: {
        invoke: vi.fn(async () => {
          throw new Error('boom')
        }),
        getInitParams: vi.fn(() => DEFAULT_INIT_PARAMS),
        isAvailable: () => true,
      },
    })
    const store = createIpcStoreModel(deps)

    const result = await store.callFunction('getEditorHistory')

    expect(result).toEqual({ success: false, error: 'Error: boom' })
    expect(deps.logError).toHaveBeenCalled()
    expect(deps.notifyError).not.toHaveBeenCalled()
  })

  it('notifies about a failure when asked to', async () => {
    const deps = createDeps({
      desktopClient: {
        invoke: vi.fn(async () => ({ success: false, error: 'no xdotool' })),
        getInitParams: vi.fn(() => DEFAULT_INIT_PARAMS),
        isAvailable: () => true,
      },
      errorTitle: () => 'Action failed',
    })
    const store = createIpcStoreModel(deps)

    const result = await store.callFunctionOrNotify('typeIntoWindowAndClose', [
      'text',
    ])

    expect(result.success).toBe(false)
    expect(deps.notifyError).toHaveBeenCalledWith('no xdotool', 'Action failed')
  })

  describe('after the params are loaded', () => {
    const loadedStore = async (
      invoke: (command: string) => Promise<unknown>
    ) => {
      const deps = createDeps({
        desktopClient: {
          invoke: vi.fn(async (command: string) =>
            command === DESKTOP_COMMANDS.GET_INIT_PARAMS
              ? { success: true, result: structuredClone(DEFAULT_INIT_PARAMS) }
              : invoke(command)
          ) as IpcStoreDeps['desktopClient']['invoke'],
          getInitParams: vi.fn(() => DEFAULT_INIT_PARAMS),
          isAvailable: () => true,
        },
      })
      const store = createIpcStoreModel(deps)
      await store.loadInitialParams()
      return { deps, store }
    }

    it('updates stored user config only after a successful save', async () => {
      const { deps, store } = await loadedStore(async () => ({ success: true }))
      const nextConfig = {
        ...DEFAULT_INIT_PARAMS.userConfig,
        xdotoolBin: '/custom/xdotool',
      }

      const result = await store.saveUserConfig(nextConfig)

      expect(result).toEqual({ success: true })
      expect(store.params.value.userConfig).toEqual(nextConfig)
      expect(deps.desktopClient.invoke).toHaveBeenLastCalledWith(
        DESKTOP_COMMANDS.SAVE_USER_CONFIG,
        { userConfig: nextConfig }
      )
    })

    it('does not replace stored user config when save fails', async () => {
      const { store } = await loadedStore(async () => ({
        success: false,
        error: 'save failed',
      }))
      const initialConfig = store.params.value.userConfig
      const nextConfig = {
        ...DEFAULT_INIT_PARAMS.userConfig,
        xdotoolBin: '/custom/xdotool',
      }

      const result = await store.saveUserConfig(nextConfig)

      expect(result).toEqual({ success: false, error: 'save failed' })
      expect(store.params.value.userConfig).toEqual(initialConfig)
    })

    it('takes the local state merged by the backend', async () => {
      const merged = { lastChatId: 'chat-1', lastMode: START_MODES.WRITE }
      const { deps, store } = await loadedStore(async () => ({
        success: true,
        result: merged,
      }))

      await store.patchLocalState({ lastMode: START_MODES.WRITE })

      expect(deps.desktopClient.invoke).toHaveBeenLastCalledWith(
        DESKTOP_COMMANDS.PATCH_LOCAL_STATE,
        { patch: { lastMode: START_MODES.WRITE } }
      )
      expect(store.params.value.localState).toEqual(merged)
    })
  })
})
