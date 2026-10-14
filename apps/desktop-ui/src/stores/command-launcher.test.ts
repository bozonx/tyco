import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { StartMode, type CommandConfig } from '@tyco/shared'

import { useCommandLauncherStore } from './command-launcher'
import { useIpcStore } from './ipc'

const mockToastText = vi.fn()
vi.mock('../composables/use-toast', () => ({
  default: () => ({ toastText: mockToastText }),
}))

let pinia: ReturnType<typeof createPinia>

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  vi.clearAllMocks()

  const ipc = useIpcStore()
  ipc.applyViewState({
    ...ipc.desktopState,
    revision: ipc.desktopState.revision + 1,
    mode: StartMode.COMMAND_LAUNCHER,
    isWindowShown: true,
    activationId: 1,
    selectedText: '',
  })
})

afterEach(() => {
  disposePinia(pinia)
})

describe('command launcher store wiring', () => {
  it('initializes and wires model with ipc and tool dependencies', () => {
    const store = useCommandLauncherStore()
    expect(store.stage.kind).toBe('list')
    expect(store.query).toBe('')
  })

  it('resets and updates page when activationId changes without launcherRequest', async () => {
    const store = useCommandLauncherStore()
    const ipc = useIpcStore()

    store.setQuery('search text')
    expect(store.query).toBe('search text')

    ipc.applyViewState({
      ...ipc.desktopState,
      revision: ipc.desktopState.revision + 1,
      userConfig: {
        ...ipc.desktopState.userConfig,
        launcherPages: [[null], [null]],
      },
      launcherPage: 1,
      launcherRequest: null,
      activationId: 2,
    })
    await nextTick()

    expect(store.query).toBe('')
    expect(store.page).toBe(1)
  })

  it('ignores activationId changes when mode is not COMMAND_LAUNCHER', async () => {
    const store = useCommandLauncherStore()
    const ipc = useIpcStore()

    store.setQuery('search text')

    ipc.applyViewState({
      ...ipc.desktopState,
      revision: ipc.desktopState.revision + 1,
      mode: StartMode.EDITOR,
      activationId: 3,
    })
    await nextTick()

    expect(store.query).toBe('search text')
  })

  it('populates text when selectedText arrives during prepare stage', async () => {
    const store = useCommandLauncherStore()
    const ipc = useIpcStore()

    const cmd: CommandConfig = {
      id: 'cmd1',
      name: 'Cmd 1',
      enabled: true,
      toolId: 'core.copy',
      toolConfig: {},
      phrases: [],
      llmArgumentParsing: false,
      launcherAfterRun: { action: 'none' },
      logOutput: false,
      availableIn: { external: false, chat: false },
    }
    store.stage = { kind: 'prepare', command: cmd, autoRun: false }

    ipc.applyViewState({
      ...ipc.desktopState,
      revision: ipc.desktopState.revision + 1,
      selectedText: 'hello selected',
    })
    await nextTick()

    expect(store.text).toBe('hello selected')
  })

  it('dismisses external preparation and resets when window hides', async () => {
    const store = useCommandLauncherStore()
    const ipc = useIpcStore()

    const cmd: CommandConfig = {
      id: 'cmd1',
      name: 'Cmd 1',
      enabled: true,
      toolId: 'core.copy',
      toolConfig: {},
      phrases: [],
      llmArgumentParsing: false,
      launcherAfterRun: { action: 'none' },
      logOutput: false,
      availableIn: { external: false, chat: false },
    }
    ipc.applyViewState({
      ...ipc.desktopState,
      revision: ipc.desktopState.revision + 1,
      userConfig: { ...ipc.desktopState.userConfig, commands: [cmd] },
    })

    await store.request({ jobId: 'job-123', commandId: 'cmd1' })
    expect(store.stage.kind).toBe('prepare')

    ipc.applyViewState({
      ...ipc.desktopState,
      revision: ipc.desktopState.revision + 1,
      isWindowShown: false,
    })
    await nextTick()

    expect(store.stage.kind).toBe('list')
  })
})
