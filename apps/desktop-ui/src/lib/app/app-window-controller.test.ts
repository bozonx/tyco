import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_USER_CONFIG,
  DESKTOP_EVENTS,
  type DesktopEventPayloads,
  type UserConfig,
} from '@tyco/shared'

import {
  createAppWindowController,
  type AppWindowControllerDependencies,
} from './app-window-controller'
import { createSettingsShutdown } from '../settings/settings-shutdown'
import { createSettingsSession } from '../settings/settings-session'
import { createMainWindowReset } from './main-window-reset'
import { useChatStore } from '../../stores/chat'
import { useChatInputStore } from '../../stores/chat-input'
import { useEditorInputStore } from '../../stores/editor-input'
import { useEditorNavigation } from '../../composables/use-editor-navigation'
import { appNavigation } from '../navigation/navigation'
import { chatAnswer } from '../chat/testing'

vi.mock('../../stores/secrets', () => ({
  useSecretsStore: () => ({ secrets: {} }),
}))
vi.mock('../../stores/llm', () => ({
  useLlmStore: () => ({
    actions: {
      sendChatMessage: async () => chatAnswer('Answer'),
      generateChatTitle: async () => '',
    },
  }),
}))
vi.mock(import('../chat/chat-image-storage'), async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    createChatImageStorage: (deps) => ({
      ...original.createChatImageStorage(deps),
      syncChatImages: async () => {},
    }),
  }
})

afterEach(() => vi.restoreAllMocks())

function fixture(overrides: Partial<AppWindowControllerDependencies> = {}) {
  const handlers = new Map<string, (payload: never) => void | Promise<void>>()
  const cleanups: ReturnType<typeof vi.fn>[] = []
  const deps: AppWindowControllerDependencies = {
    isQuickWindow: false,
    listen: vi.fn(async (event, handler) => {
      handlers.set(event, handler as (payload: never) => void | Promise<void>)
      const cleanup = vi.fn()
      cleanups.push(cleanup)
      return cleanup
    }),
    reportError: vi.fn(),
    startBootstrap: vi.fn(async () => {}),
    stopBootstrap: vi.fn(),
    startMetrics: vi.fn(async () => {}),
    stopMetrics: vi.fn(),
    disposePlugins: vi.fn(async () => {}),
    refreshPlugins: vi.fn(async () => {}),
    shutdown: {
      request: vi.fn(async () => {}),
      cancel: vi.fn(),
      dispose: vi.fn(),
    },
    runSelection: vi.fn(async () => {}),
    cancelSelection: vi.fn(),
    runCommand: vi.fn(async () => {}),
    cancelCommand: vi.fn(),
    cancelLauncher: vi.fn(),
    closeModals: vi.fn(),
    goToChat: vi.fn(async () => {}),
    startChat: vi.fn(async () => {}),
    openLastChat: vi.fn(async () => {}),
    afterRender: vi.fn(async () => {}),
    setChatInput: vi.fn(),
    sendChatInput: vi.fn(async () => {}),
    focusChatInput: vi.fn(),
    applyEditorTransfer: vi.fn(),
    goToEditor: vi.fn(async () => {}),
    resetMainWindow: vi.fn(async () => {}),
    ...overrides,
  }
  const controller = createAppWindowController(deps)
  const deliver = async <K extends keyof DesktopEventPayloads>(
    event: K,
    payload: DesktopEventPayloads[K]
  ) => {
    await handlers.get(event)?.(payload as never)
  }
  return { deps, controller, handlers, cleanups, deliver }
}

describe('application window events', () => {
  it('opens and sends a trimmed question with its attachment after rendering', async () => {
    const f = fixture()
    await f.controller.start()
    await f.deliver(DESKTOP_EVENTS.OPEN_MAIN_CHAT, {
      attachment: { text: ' Context ', source: 'selection' },
      question: ' Question ',
      autoSend: true,
    })
    expect(f.deps.startChat).toHaveBeenCalledWith({
      attachments: [{ text: 'Context', source: 'selection' }],
    })
    expect(f.deps.setChatInput).toHaveBeenCalledWith('Question')
    expect(f.deps.afterRender).toHaveBeenCalledOnce()
    expect(f.deps.sendChatInput).toHaveBeenCalledOnce()
    expect(f.deps.focusChatInput).not.toHaveBeenCalled()
    f.controller.stop()
  })

  it('opens the last chat for an empty payload and focuses an unsent question', async () => {
    const f = fixture()
    await f.controller.start()
    await f.deliver(DESKTOP_EVENTS.OPEN_MAIN_CHAT, {
      question: '  ',
      autoSend: false,
    })
    expect(f.deps.openLastChat).toHaveBeenCalledOnce()
    expect(f.deps.setChatInput).not.toHaveBeenCalled()
    await f.deliver(DESKTOP_EVENTS.OPEN_MAIN_CHAT, {
      question: 'Draft',
      autoSend: false,
    })
    expect(f.deps.startChat).toHaveBeenCalledWith({})
    expect(f.deps.focusChatInput).toHaveBeenCalledOnce()
    expect(f.deps.sendChatInput).not.toHaveBeenCalled()
    f.controller.stop()
  })

  it('assigns background operations exclusively to the quick window', async () => {
    const main = fixture()
    const quick = fixture({ isQuickWindow: true })
    await Promise.all([main.controller.start(), quick.controller.start()])
    expect(main.handlers.has(DESKTOP_EVENTS.COMMAND_RUN)).toBe(false)
    expect(main.handlers.has(DESKTOP_EVENTS.SELECTION_RUN)).toBe(false)
    expect(quick.handlers.has(DESKTOP_EVENTS.OPEN_MAIN_CHAT)).toBe(false)
    expect(quick.handlers.has(DESKTOP_EVENTS.OPEN_MAIN_EDITOR)).toBe(false)
    await quick.deliver(DESKTOP_EVENTS.EXTERNAL_JOB_CANCEL, 'job')
    expect(quick.deps.cancelCommand).toHaveBeenCalledWith('job')
    expect(quick.deps.cancelLauncher).toHaveBeenCalledWith('job')
    await quick.deliver(DESKTOP_EVENTS.SELECTION_CANCEL, { runId: 3 })
    expect(quick.deps.cancelSelection).toHaveBeenCalledWith(3)
    expect(main.deps.startMetrics).not.toHaveBeenCalled()
    expect(quick.deps.startMetrics).toHaveBeenCalledOnce()
    main.controller.stop()
    quick.controller.stop()
  })

  it('discards an earlier open request when another request arrives', async () => {
    let finish!: () => void
    const goToChat = vi.fn(async () => {})
    goToChat.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const f = fixture({ goToChat })
    await f.controller.start()
    const earlier = f.deliver(DESKTOP_EVENTS.OPEN_MAIN_CHAT, {
      question: 'Earlier',
      autoSend: true,
    })
    await f.deliver(DESKTOP_EVENTS.OPEN_MAIN_CHAT, {
      question: 'Current',
      autoSend: false,
    })
    finish()
    await earlier
    expect(f.deps.setChatInput).toHaveBeenCalledOnce()
    expect(f.deps.setChatInput).toHaveBeenCalledWith('Current')
    expect(f.deps.sendChatInput).not.toHaveBeenCalled()
    f.controller.stop()
  })

  it('invalidates pending chat opens when the main window closes', async () => {
    let finish!: () => void
    const f = fixture({
      afterRender: () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    })
    await f.controller.start()
    const open = f.deliver(DESKTOP_EVENTS.OPEN_MAIN_CHAT, {
      question: 'Question',
      autoSend: true,
    })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await f.deliver(DESKTOP_EVENTS.MAIN_WINDOW_CLOSED, null)
    finish()
    await open
    expect(f.deps.resetMainWindow).toHaveBeenCalledOnce()
    expect(f.deps.sendChatInput).not.toHaveBeenCalled()
    f.controller.stop()
  })

  it('releases subscriptions and prevents work after stopping', async () => {
    let finish!: () => void
    const f = fixture({
      isQuickWindow: true,
      startBootstrap: () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    })
    const start = f.controller.start()
    expect(f.controller.start()).toBe(start)
    f.controller.stop()
    finish()
    await start
    expect(f.cleanups.every((cleanup) => cleanup.mock.calls.length === 1)).toBe(
      true
    )
    await f.deliver(DESKTOP_EVENTS.QUIT_REQUESTED, 1)
    expect(f.deps.shutdown.request).not.toHaveBeenCalled()
    f.controller.stop()
    expect(f.deps.disposePlugins).toHaveBeenCalledOnce()
  })
})

describe('application workflow integration', () => {
  it('passes a desktop question through the real chat store and input model', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    vi.spyOn(appNavigation, 'push').mockResolvedValue()
    const chat = useChatStore()
    const input = useChatInputStore()
    const f = fixture({
      startChat: chat.startChat,
      openLastChat: chat.openLastOrNewChat,
      setChatInput: input.setValue,
      sendChatInput: chat.sendInput,
      focusChatInput: input.requestFocus,
      afterRender: nextTick,
    })
    try {
      await f.controller.start()
      await f.deliver(DESKTOP_EVENTS.OPEN_MAIN_CHAT, {
        attachment: { text: 'Context', source: 'selection' },
        question: 'Question',
        autoSend: true,
      })
      await vi.waitFor(() => expect(chat.isGenerating).toBe(false))
      expect(input.value).toBe('')
      expect(chat.messages[0]).toMatchObject({
        content: 'Question',
        attachments: [{ text: 'Context', source: 'selection' }],
      })
      expect(chat.messages[1]?.content).toBe('Answer')
    } finally {
      f.controller.stop()
      disposePinia(pinia)
    }
  })

  it('applies transferred text to the real editor selection and resets only navigation on close', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const goToEditor = vi.spyOn(appNavigation, 'goToEditor').mockResolvedValue()
    const editor = useEditorInputStore()
    editor.setValue('before old after')
    editor.setSelection('old', 7, 10)
    const navigation = useEditorNavigation()
    const closeModals = vi.fn()
    const reset = createMainWindowReset({
      closeAllModals: closeModals,
      goToEditor: appNavigation.goToEditor,
    })
    const f = fixture({
      applyEditorTransfer: navigation.applyEditorTransfer,
      goToEditor: appNavigation.goToEditor,
      resetMainWindow: reset.reset,
    })
    try {
      await f.controller.start()
      await f.deliver(DESKTOP_EVENTS.OPEN_MAIN_EDITOR, {
        text: 'new',
        sourceText: 'old',
      })
      expect(editor.value).toBe('before new after')
      expect(goToEditor).toHaveBeenCalledOnce()
      await f.deliver(DESKTOP_EVENTS.MAIN_WINDOW_CLOSED, null)
      expect(closeModals).toHaveBeenCalledOnce()
      expect(editor.value).toBe('before new after')
    } finally {
      f.controller.stop()
      disposePinia(pinia)
    }
  })

  it.each([true, false])(
    'acknowledges shutdown only after the real draft save (success: %s)',
    async (success) => {
      let finish!: (
        result: Awaited<
          ReturnType<Parameters<typeof createSettingsSession>[0]['save']>
        >
      ) => void
      let canSave = true
      const initialConfig = structuredClone(DEFAULT_USER_CONFIG)
      const session = createSettingsSession({
        initialConfig,
        prepare: (config) => config as UserConfig,
        save: () =>
          new Promise((resolve) => {
            finish = resolve
          }),
        canSave: () => canSave,
        notifyError: vi.fn(),
        debounceMs: 500,
      })
      session.draft.value.appearance.theme = 'dark'
      const acknowledge = vi.fn(async () => {})
      const shutdown = createSettingsShutdown({
        flush: async () => {
          await session.persist()
          return session.isSaved()
        },
        acknowledge,
        notifyError: vi.fn(),
      })
      const f = fixture({ shutdown })
      try {
        await f.controller.start()
        const quit = f.deliver(DESKTOP_EVENTS.QUIT_REQUESTED, 7)
        expect(shutdown.isClosing.value).toBe(true)
        expect(acknowledge).not.toHaveBeenCalled()
        await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
        finish(
          success
            ? {
                success: true,
                result: {
                  ...initialConfig,
                  appearance: { ...initialConfig.appearance, theme: 'dark' },
                },
              }
            : { success: false, error: 'Storage unavailable' }
        )
        await quit
        expect(acknowledge).toHaveBeenCalledWith(7, success)
        await f.deliver(DESKTOP_EVENTS.QUIT_CANCELLED, null)
        expect(shutdown.isClosing.value).toBe(false)
      } finally {
        f.controller.stop()
        canSave = false
        await session.dispose()
      }
    }
  )
})
