import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { ActivationMode, type CommandConfig } from '@tyco/shared'

import { useCommandLauncherStore } from './command-launcher'
import { useDesktopStore } from './desktop'

const mockToastText = vi.fn()
vi.mock('./toast', () => ({
  useToastStore: () => ({
    addToast: vi.fn(),
    toastKey: vi.fn(),
    toastText: mockToastText,
  }),
}))

let pinia: ReturnType<typeof createPinia>

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  vi.clearAllMocks()

  const desktop = useDesktopStore()
  desktop.applyViewState({
    ...desktop.desktopState,
    revision: desktop.desktopState.revision + 1,
    mode: ActivationMode.COMMAND_LAUNCHER,
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
    const desktop = useDesktopStore()

    store.setQuery('search text')
    expect(store.query).toBe('search text')

    desktop.applyViewState({
      ...desktop.desktopState,
      revision: desktop.desktopState.revision + 1,
      userConfig: {
        ...desktop.desktopState.userConfig,
        launcherPages: ['main', 'other'].map((id) => ({
          id,
          inputMode: 'selection',
          hotkey: '',
          slots: {},
        })),
      },
      launcherPageId: 'other',
      launcherRequest: null,
      activationId: 2,
    })
    await nextTick()

    expect(store.query).toBe('')
    expect(store.pageIndex).toBe(1)
  })

  it('ignores activationId changes when mode is not COMMAND_LAUNCHER', async () => {
    const store = useCommandLauncherStore()
    const desktop = useDesktopStore()

    store.setQuery('search text')

    desktop.applyViewState({
      ...desktop.desktopState,
      revision: desktop.desktopState.revision + 1,
      mode: ActivationMode.EDITOR,
      activationId: 3,
    })
    await nextTick()

    expect(store.query).toBe('search text')
  })

  it('populates text when selectedText arrives during prepare stage', async () => {
    const store = useCommandLauncherStore()
    const desktop = useDesktopStore()

    const cmd: CommandConfig = {
      id: 'cmd1',
      name: 'Cmd 1',
      isEnabled: true,
      toolId: 'core.copy',
      toolConfig: {},
      phrases: [],
      isLlmArgumentParsingEnabled: false,
      isVoiceEnabled: false,
      outputAction: 'none',
      isOutputLogged: false,
      isAvailableExternally: false,
    }
    store.stage = { kind: 'prepare', command: cmd, autoRun: false }

    desktop.applyViewState({
      ...desktop.desktopState,
      revision: desktop.desktopState.revision + 1,
      selectedText: 'hello selected',
    })
    await nextTick()

    expect(store.inputText).toBe('hello selected')
  })

  it('dismisses external preparation and resets when window hides', async () => {
    const store = useCommandLauncherStore()
    const desktop = useDesktopStore()

    const cmd: CommandConfig = {
      id: 'cmd1',
      name: 'Cmd 1',
      isEnabled: true,
      toolId: 'core.copy',
      toolConfig: {},
      phrases: [],
      isLlmArgumentParsingEnabled: false,
      isVoiceEnabled: false,
      outputAction: 'none',
      isOutputLogged: false,
      isAvailableExternally: false,
    }
    desktop.applyViewState({
      ...desktop.desktopState,
      revision: desktop.desktopState.revision + 1,
      userConfig: { ...desktop.desktopState.userConfig, commands: [cmd] },
    })

    await store.request({ jobId: 'job-123', commandId: 'cmd1' })
    expect(store.stage.kind).toBe('prepare')

    desktop.applyViewState({
      ...desktop.desktopState,
      revision: desktop.desktopState.revision + 1,
      isWindowShown: false,
    })
    await nextTick()

    expect(store.stage.kind).toBe('list')
  })
})
