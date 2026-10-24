import { DEFAULT_DESKTOP_VIEW_STATE, desktopViewToSnapshot } from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'

import { createDesktopStateModel } from './desktop-state'
import {
  type IpcModelDependencies,
  createIpcModel,
  resultOrThrow,
} from './ipc-model'

function createDeps(
  overrides: Partial<IpcModelDependencies> = {}
): IpcModelDependencies {
  const invokeMock: IpcModelDependencies['desktopClient']['invoke'] = vi.fn(
    async () => ({ success: true, result: ['ok'] })
  ) as IpcModelDependencies['desktopClient']['invoke']

  return {
    desktopClient: {
      invoke: invokeMock,
      getDesktopViewState: vi.fn(() => DEFAULT_DESKTOP_VIEW_STATE),
      isAvailable: () => true,
    },
    notifyError: vi.fn(),
    logError: vi.fn(),
    getActivationId: () => DEFAULT_DESKTOP_VIEW_STATE.activationId,
    ...overrides,
  }
}

/** The calls and the state wired together, as the desktop runtime store does */
function createModels(deps: IpcModelDependencies) {
  const ipc = createIpcModel({
    ...deps,
    getActivationId: () => state.desktopState.value.activationId,
  })
  const state = createDesktopStateModel({
    desktopClient: deps.desktopClient,
    call: ipc.call,
    reportFailure: ipc.reportFailure,
  })
  return { ...ipc, ...state }
}

describe('ipc-model', () => {
  it('binds quick dismissal and input regions to their activation', async () => {
    const deps = createDeps()
    const store = createModels(deps)
    await store.call('hide_quick_window_on_blur')
    expect(deps.desktopClient.invoke).toHaveBeenCalledWith(
      'hide_quick_window_on_blur',
      { activationId: DEFAULT_DESKTOP_VIEW_STATE.activationId }
    )
    const region = { x: 0, y: 400, width: 800, height: 100 }
    await store.call('set_quick_input_region', { region })
    expect(deps.desktopClient.invoke).toHaveBeenCalledWith(
      'set_quick_input_region',
      { region, activationId: DEFAULT_DESKTOP_VIEW_STATE.activationId }
    )
  })
  it('maps a transfer to the decorated editor window', async () => {
    const deps = createDeps()
    const store = createModels(deps)

    await store.call('open_main_editor', {
      text: 'result',
      sourceText: 'source',
    })

    expect(deps.desktopClient.invoke).toHaveBeenCalledWith('open_main_editor', {
      text: 'result',
      sourceText: 'source',
      activationId: DEFAULT_DESKTOP_VIEW_STATE.activationId,
    })
  })

  it('binds a voice handoff to the activation that produced its question', async () => {
    const deps = createDeps()
    const store = createModels(deps)
    await store.call('open_main_chat', {
      attachment: undefined,
      question: 'Question',
      autoSend: true,
    })
    expect(deps.desktopClient.invoke).toHaveBeenCalledWith('open_main_chat', {
      attachment: undefined,
      question: 'Question',
      autoSend: true,
      activationId: DEFAULT_DESKTOP_VIEW_STATE.activationId,
    })
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
    const store = createModels(deps)

    await store.call('paste_into_target_and_hide', { text: 'text' })
    await store.call('copy_text', { text: 'text' })

    expect(order).toEqual(['released', 'invoked', 'invoked'])
    expect(deps.desktopClient.invoke).toHaveBeenCalledWith(
      'paste_into_target_and_hide',
      { text: 'text', activationId: 0 }
    )
  })

  it('passes the arguments of other commands as they are', async () => {
    const deps = createDeps()
    const store = createModels(deps)

    await store.call('set_editor_history_item_result', {
      id: 'id-1',
      result: 'abc',
    })
    await store.call('get_storage_info')

    expect(deps.desktopClient.invoke).toHaveBeenCalledWith(
      'set_editor_history_item_result',
      { id: 'id-1', result: 'abc' }
    )
    expect(deps.desktopClient.invoke).toHaveBeenLastCalledWith(
      'get_storage_info',
      undefined
    )
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
    const store = createModels(deps)

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
    const store = createModels(deps)

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
    const store = createModels(deps)

    const result = await store.call('get_editor_history')

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
    const store = createModels(deps)

    const result = await store.callOrNotify('paste_into_target_and_hide', {
      text: 'text',
    })

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
            command === 'get_desktop_state'
              ? {
                  success: true,
                  result: desktopViewToSnapshot(
                    structuredClone(DEFAULT_DESKTOP_VIEW_STATE)
                  ),
                }
              : invoke(command)
          ) as IpcModelDependencies['desktopClient']['invoke'],
          getDesktopViewState: vi.fn(() => DEFAULT_DESKTOP_VIEW_STATE),
          isAvailable: () => true,
        },
      })
      const store = createModels(deps)
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
  const store = createModels(deps)
  store.applyViewState({
    ...DEFAULT_DESKTOP_VIEW_STATE,
    revision: 1,
    activationId: 10,
  })
  const pending = store.call('paste_into_target_and_hide', { text: 'Result' })
  store.applyViewState({
    ...DEFAULT_DESKTOP_VIEW_STATE,
    revision: 2,
    activationId: 11,
  })
  release()
  await pending
  expect(deps.desktopClient.invoke).toHaveBeenCalledWith(
    'paste_into_target_and_hide',
    { text: 'Result', activationId: 10 }
  )
})

describe('resultOrThrow', () => {
  it('returns the result of a successful call', () => {
    expect(resultOrThrow({ success: true, result: 'path' })).toBe('path')
  })

  it('throws the failure, or the fallback for one without a message', () => {
    expect(() => resultOrThrow({ success: false, error: 'no vault' })).toThrow(
      'no vault'
    )
    expect(() =>
      resultOrThrow({ success: false, error: '' }, 'Vault failed')
    ).toThrow('Vault failed')
  })
})
