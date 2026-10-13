import {
  DEFAULT_DESKTOP_VIEW_STATE,
  desktopViewToSnapshot,
  StartMode,
  type DesktopViewState,
} from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'

import { GlobalEvents } from './global-events'
import { APP_ROUTES } from '../navigation/routes'
import { createAppBootstrap, type AppBootstrapDeps } from './app-bootstrap'

function createDeps(overrides: Partial<AppBootstrapDeps> = {}) {
  const listeners = new Map<
    string,
    (payload: unknown) => void | Promise<void>
  >()

  const deps: AppBootstrapDeps = {
    loadDesktopState: vi.fn(async () => ({
      ...DEFAULT_DESKTOP_VIEW_STATE,
      mode: StartMode.EDITOR,
    })),
    applyViewState: vi.fn(),
    closeAllModals: vi.fn(),
    navigateTo: vi.fn(async () => {}),
    listen: vi.fn(
      async (
        event: string,
        handler: (payload: never) => void | Promise<void>
      ) => {
        listeners.set(
          event,
          handler as (payload: unknown) => void | Promise<void>
        )
        return vi.fn()
      }
    ),
    emitGlobal: vi.fn(),
    initPlugins: vi.fn(),
    handleNavKeyUp: vi.fn(),
    addWindowKeyupListener: vi.fn(() => vi.fn()),
    ...overrides,
  }

  return { deps, listeners }
}

describe('app-bootstrap', () => {
  it('applies params and navigates using mode', async () => {
    const { deps } = createDeps()
    const bootstrap = createAppBootstrap(deps)
    const params: DesktopViewState = {
      ...DEFAULT_DESKTOP_VIEW_STATE,
      mode: StartMode.AI_TASKS,
    }

    await bootstrap.applyParams(params)

    expect(deps.applyViewState).toHaveBeenCalledWith(params)
    expect(deps.closeAllModals).toHaveBeenCalledOnce()
    expect(deps.navigateTo).toHaveBeenCalledWith(APP_ROUTES.AI_TASKS.path)
  })

  it('starts runtime listeners and emits init event', async () => {
    const { deps, listeners } = createDeps({
      loadDesktopState: vi.fn(async () => ({
        ...DEFAULT_DESKTOP_VIEW_STATE,
        mode: StartMode.WRITE,
      })),
    })
    const bootstrap = createAppBootstrap(deps)

    await bootstrap.start()

    expect(deps.initPlugins).toHaveBeenCalledOnce()
    expect(deps.addWindowKeyupListener).toHaveBeenCalledOnce()
    expect(deps.listen).toHaveBeenCalledTimes(1)
    expect(deps.navigateTo).toHaveBeenCalledWith(APP_ROUTES.WRITE.path)
    expect(deps.emitGlobal).toHaveBeenCalledWith(GlobalEvents.INITED)
    expect(listeners.size).toBe(1)
  })

  it('does not navigate again when params change without mode change', async () => {
    const { deps, listeners } = createDeps({
      loadDesktopState: vi.fn(async () => ({
        ...DEFAULT_DESKTOP_VIEW_STATE,
        mode: StartMode.EDITOR,
      })),
    })
    const bootstrap = createAppBootstrap(deps)

    await bootstrap.start()
    expect(deps.navigateTo).toHaveBeenCalledTimes(1)

    const paramsChangedHandler = listeners.get('app://state-changed')
    expect(paramsChangedHandler).toBeTypeOf('function')

    await paramsChangedHandler?.(
      desktopViewToSnapshot({
        ...DEFAULT_DESKTOP_VIEW_STATE,
        mode: StartMode.EDITOR,
        revision: 1,
        userConfig: {
          ...DEFAULT_DESKTOP_VIEW_STATE.userConfig,
          xdotoolBin: '/custom/xdotool',
        },
      })
    )

    expect(deps.navigateTo).toHaveBeenCalledTimes(1)
  })

  it('navigates when params change with a new mode', async () => {
    const { deps, listeners } = createDeps({
      loadDesktopState: vi.fn(async () => ({
        ...DEFAULT_DESKTOP_VIEW_STATE,
        mode: StartMode.EDITOR,
      })),
    })
    const bootstrap = createAppBootstrap(deps)

    await bootstrap.start()

    const paramsChangedHandler = listeners.get('app://state-changed')
    expect(paramsChangedHandler).toBeTypeOf('function')

    await paramsChangedHandler?.(
      desktopViewToSnapshot({
        ...DEFAULT_DESKTOP_VIEW_STATE,
        mode: StartMode.WRITE,
        revision: 1,
      })
    )

    expect(deps.navigateTo).toHaveBeenNthCalledWith(2, APP_ROUTES.WRITE.path)
  })

  it('closes previous modal operations on a new activation in the same mode', async () => {
    const { deps } = createDeps()
    const bootstrap = createAppBootstrap(deps)
    await bootstrap.applyParams({
      ...DEFAULT_DESKTOP_VIEW_STATE,
      activationId: 1,
    })
    await bootstrap.applyParams({
      ...DEFAULT_DESKTOP_VIEW_STATE,
      activationId: 2,
      revision: 1,
    })
    expect(deps.closeAllModals).toHaveBeenCalledTimes(2)
    expect(deps.navigateTo).toHaveBeenCalledOnce()
    await bootstrap.applyParams({
      ...DEFAULT_DESKTOP_VIEW_STATE,
      activationId: 2,
      revision: 2,
    })
    expect(deps.closeAllModals).toHaveBeenCalledTimes(2)
  })

  it('leaves the screen alone for a mode of the other window', async () => {
    const { deps, listeners } = createDeps({
      ownsMode: (mode) => mode !== StartMode.VOICE,
    })
    const bootstrap = createAppBootstrap(deps)

    await bootstrap.start()
    const paramsChangedHandler = listeners.get('app://state-changed')
    const voice = {
      ...DEFAULT_DESKTOP_VIEW_STATE,
      revision: 1,
      mode: StartMode.VOICE,
    }
    await paramsChangedHandler?.(desktopViewToSnapshot(voice))

    expect(deps.applyViewState).toHaveBeenLastCalledWith(voice)
    expect(deps.navigateTo).toHaveBeenCalledTimes(1)
    expect(deps.closeAllModals).toHaveBeenCalledTimes(1)

    // back to the screen it already shows: nothing to redo
    await paramsChangedHandler?.(
      desktopViewToSnapshot({
        ...DEFAULT_DESKTOP_VIEW_STATE,
        mode: StartMode.EDITOR,
        revision: 2,
      })
    )
    expect(deps.navigateTo).toHaveBeenCalledTimes(1)
  })

  it('starts on the home screen with a mode of the other window', async () => {
    const { deps } = createDeps({
      loadDesktopState: vi.fn(async () => ({
        ...DEFAULT_DESKTOP_VIEW_STATE,
        mode: StartMode.VOICE,
      })),
      ownsMode: (mode) => mode !== StartMode.VOICE,
    })

    await createAppBootstrap(deps).start()

    expect(deps.navigateTo).toHaveBeenCalledExactlyOnceWith(
      APP_ROUTES.HOME.path
    )
  })

  it('forwards keyup events to global events and nav handler', () => {
    const { deps } = createDeps()
    const bootstrap = createAppBootstrap(deps)
    const event = new KeyboardEvent('keyup', { code: 'Escape' })

    bootstrap.handleKeyUp(event)

    expect(deps.emitGlobal).toHaveBeenCalledWith(GlobalEvents.KEY_UP, event)
    expect(deps.handleNavKeyUp).toHaveBeenCalledWith(event)
  })
})

describe('bootstrap lifetime', () => {
  it('rolls back subscriptions when loading fails and can retry', async () => {
    const removeKey = vi.fn()
    const removeEvent = vi.fn()
    const { deps } = createDeps({
      addWindowKeyupListener: () => removeKey,
      listen: async () => removeEvent,
      loadDesktopState: vi
        .fn()
        .mockRejectedValueOnce(new Error('Failed'))
        .mockResolvedValue(DEFAULT_DESKTOP_VIEW_STATE),
    })
    const bootstrap = createAppBootstrap(deps)
    await expect(bootstrap.start()).rejects.toThrow('Failed')
    expect(removeKey).toHaveBeenCalledOnce()
    expect(removeEvent).toHaveBeenCalledTimes(1)
    await bootstrap.start()
    expect(deps.emitGlobal).toHaveBeenCalledWith(GlobalEvents.INITED)
  })

  it('does not initialize after a pending load finishes following stop', async () => {
    let resolve!: (params: DesktopViewState) => void
    const { deps } = createDeps({
      loadDesktopState: () =>
        new Promise((done) => {
          resolve = done
        }),
    })
    const bootstrap = createAppBootstrap(deps)
    const pending = bootstrap.start()
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    bootstrap.stop()
    resolve(DEFAULT_DESKTOP_VIEW_STATE)
    await pending
    expect(deps.initPlugins).not.toHaveBeenCalled()
    expect(deps.applyViewState).not.toHaveBeenCalled()
  })
})

describe('bootstrap snapshot ordering', () => {
  it('does not navigate to an older initial mode after a newer activation', async () => {
    let finish!: (params: DesktopViewState) => void
    const { deps, listeners } = createDeps({
      loadDesktopState: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    })
    const bootstrap = createAppBootstrap(deps)
    const pending = bootstrap.start()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await listeners.get('app://state-changed')?.(
      desktopViewToSnapshot({
        ...DEFAULT_DESKTOP_VIEW_STATE,
        revision: 2,
        mode: StartMode.VOICE,
      })
    )
    finish({
      ...DEFAULT_DESKTOP_VIEW_STATE,
      revision: 1,
      mode: StartMode.EDITOR,
    })
    await pending
    expect(deps.navigateTo).toHaveBeenCalledExactlyOnceWith(
      APP_ROUTES.VOICE.path
    )
    expect(deps.applyViewState).toHaveBeenCalledTimes(1)
  })
})

it('resynchronizes snapshots on focus and disposes the focus listener', async () => {
  let focus!: () => void
  const remove = vi.fn()
  const { deps } = createDeps({
    addWindowFocusListener: (handler) => {
      focus = handler
      return remove
    },
  })
  const bootstrap = createAppBootstrap(deps)
  await bootstrap.start()
  vi.mocked(deps.loadDesktopState).mockResolvedValueOnce({
    ...DEFAULT_DESKTOP_VIEW_STATE,
    revision: 3,
    mode: StartMode.WRITE,
  })
  focus()
  await vi.waitFor(() =>
    expect(deps.navigateTo).toHaveBeenLastCalledWith(APP_ROUTES.WRITE.path)
  )
  bootstrap.stop()
  expect(remove).toHaveBeenCalledOnce()
})
