import { DEFAULT_INIT_PARAMS, START_MODES, type InitParams } from '@shared'
import { describe, expect, it, vi } from 'vitest'

import { GlobalEvents } from '../../composables/useGlobalEvents'
import { APP_ROUTES } from '../navigation/routes'
import { createAppBootstrap, type AppBootstrapDeps } from './app-bootstrap'

function createDeps(overrides: Partial<AppBootstrapDeps> = {}) {
  const listeners = new Map<string, (payload: unknown) => void | Promise<void>>()

  const deps: AppBootstrapDeps = {
    loadInitialParams: vi.fn(async () => ({
      ...DEFAULT_INIT_PARAMS,
      mode: START_MODES.EDITOR,
    })),
    setParams: vi.fn(),
    closeAllModals: vi.fn(),
    navigateTo: vi.fn(async () => {}),
    listen: vi.fn(async (event: string, handler: (payload: unknown) => void | Promise<void>) => {
      listeners.set(event, handler)
      return vi.fn()
    }),
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
    const params: InitParams = {
      ...DEFAULT_INIT_PARAMS,
      mode: START_MODES.AI_TASKS,
    }

    await bootstrap.applyParams(params)

    expect(deps.setParams).toHaveBeenCalledWith(params)
    expect(deps.closeAllModals).toHaveBeenCalledOnce()
    expect(deps.navigateTo).toHaveBeenCalledWith(APP_ROUTES.AI_TASKS.path)
  })

  it('starts runtime listeners and emits init event', async () => {
    const { deps, listeners } = createDeps({
      loadInitialParams: vi.fn(async () => ({
        ...DEFAULT_INIT_PARAMS,
        mode: START_MODES.WRITE,
      })),
    })
    const bootstrap = createAppBootstrap(deps)

    await bootstrap.start()

    expect(deps.initPlugins).toHaveBeenCalledOnce()
    expect(deps.addWindowKeyupListener).toHaveBeenCalledOnce()
    expect(deps.listen).toHaveBeenCalledTimes(2)
    expect(deps.navigateTo).toHaveBeenCalledWith(APP_ROUTES.WRITE.path)
    expect(deps.emitGlobal).toHaveBeenCalledWith(GlobalEvents.INITED)
    expect(listeners.size).toBe(2)
  })

  it('does not navigate again when params change without mode change', async () => {
    const { deps, listeners } = createDeps({
      loadInitialParams: vi.fn(async () => ({
        ...DEFAULT_INIT_PARAMS,
        mode: START_MODES.EDITOR,
      })),
    })
    const bootstrap = createAppBootstrap(deps)

    await bootstrap.start()
    expect(deps.navigateTo).toHaveBeenCalledTimes(1)

    const paramsChangedHandler = listeners.get('app://params-changed')
    expect(paramsChangedHandler).toBeTypeOf('function')

    await paramsChangedHandler?.({
      ...DEFAULT_INIT_PARAMS,
      mode: START_MODES.EDITOR,
      userConfig: {
        ...DEFAULT_INIT_PARAMS.userConfig,
        xdotoolBin: '/custom/xdotool',
      },
    })

    expect(deps.navigateTo).toHaveBeenCalledTimes(1)
  })

  it('navigates when params change with a new mode', async () => {
    const { deps, listeners } = createDeps({
      loadInitialParams: vi.fn(async () => ({
        ...DEFAULT_INIT_PARAMS,
        mode: START_MODES.EDITOR,
      })),
    })
    const bootstrap = createAppBootstrap(deps)

    await bootstrap.start()

    const paramsChangedHandler = listeners.get('app://params-changed')
    expect(paramsChangedHandler).toBeTypeOf('function')

    await paramsChangedHandler?.({
      ...DEFAULT_INIT_PARAMS,
      mode: START_MODES.WRITE,
    })

    expect(deps.navigateTo).toHaveBeenNthCalledWith(2, APP_ROUTES.WRITE.path)
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
