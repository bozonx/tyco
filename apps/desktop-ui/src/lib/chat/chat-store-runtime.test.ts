import {
  DEFAULT_SESSION_STATE,
  DEFAULT_USER_CONFIG,
  type AiProfile,
  type SessionState,
} from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'

import type { invokeDesktop } from '../desktop/invoke'
import { createChatInputModel } from './chat-input-model'
import {
  createChatStoreRuntime,
  type ChatStoreHistory,
  type ChatStoreRuntimeDependencies,
} from './chat-store-runtime'
import { chatAnswer } from './testing'

function createFakeHistory(): ChatStoreHistory {
  return {
    chatHistory: ref([]),
    loadChatHistory: vi.fn(async () => {}),
    loadChat: vi.fn(async () => null),
    saveChat: vi.fn(async () => {}),
    renameChat: vi.fn(async () => {}),
    deleteChat: vi.fn(async () => null),
    restoreChatItem: vi.fn(async () => {}),
    clearChats: vi.fn(async () => {}),
    searchChats: vi.fn(async () => []),
  }
}

function runtimeDependencies(profileId: string): ChatStoreRuntimeDependencies {
  const profile: AiProfile = {
    id: profileId,
    name: profileId,
    memoryMode: 'auto',
    projectPermissions: {},
    createdAt: 1,
    updatedAt: 1,
  }
  return {
    profileId,
    invoke: vi.fn() as unknown as typeof invokeDesktop,
    history: createFakeHistory(),
    llmActions: {
      sendChatMessage: vi.fn(async () => chatAnswer('reply')),
      generateChatTitle: vi.fn(async () => ''),
    },
    editor: { value: '', selectedText: '' },
    input: reactive(createChatInputModel()),
    getProfile: () => profile,
    refreshProfile: vi.fn(async () => profile),
    readSoul: vi.fn(async () => '# Soul'),
    updateProfileModel: vi.fn(async () => {}),
    getUserConfig: () => structuredClone(DEFAULT_USER_CONFIG),
    getSessionState: () => structuredClone(DEFAULT_SESSION_STATE),
    saveSessionState: vi.fn(async () => ({ success: true })),
    hasSecret: () => true,
    externalSelection: () => '',
    windowLabel: () => 'main',
    openMainChat: vi.fn(async () => {}),
    closeModals: vi.fn(),
    afterRender: vi.fn(async () => {}),
    navigateTo: vi.fn(async () => {}),
    translate: (key) => key,
    toastText: vi.fn(),
    toastKey: vi.fn(),
    warn: vi.fn(),
  }
}

describe('chat-store-runtime', () => {
  it('sends independent profile patches when two chats open before either save completes', async () => {
    const saved: Partial<SessionState>[] = []
    let finish!: () => void
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    const saveSessionState: ChatStoreRuntimeDependencies['saveSessionState'] =
      async (patch) => {
        saved.push(patch)
        await pending
        return { success: true }
      }
    const runtimes = ['writer', 'reviewer'].map((id) => {
      const deps = runtimeDependencies(id)
      deps.saveSessionState = saveSessionState
      vi.mocked(deps.invoke).mockResolvedValue({
        id: `chat-${id}`,
        title: id,
        lastMessageAt: 1,
        messages: [],
      })
      return createChatStoreRuntime(deps)
    })
    try {
      const opens = runtimes.map((runtime, index) =>
        runtime.openChat(`chat-${index}`)
      )
      await vi.waitFor(() => expect(saved).toHaveLength(2))
      expect(saved).toEqual([
        { lastProfileChatIds: { writer: 'chat-writer' } },
        { lastProfileChatIds: { reviewer: 'chat-reviewer' } },
      ])
      finish()
      await Promise.all(opens)
    } finally {
      finish()
      runtimes.forEach((runtime) => runtime.dispose())
    }
  })

  it('wires profile image loading through the injected transport', async () => {
    const deps = runtimeDependencies('writer')
    const invoke = vi.fn(async () => [1, 2, 255])
    deps.invoke = invoke as unknown as typeof invokeDesktop
    const sendChatMessage = vi.fn<
      ChatStoreRuntimeDependencies['llmActions']['sendChatMessage']
    >(async (_message, _previous, _instructions, options) => {
      expect(await options?.loadImage?.('image-1')).toEqual(
        new Uint8Array([1, 2, 255])
      )
      return chatAnswer('reply')
    })
    deps.llmActions.sendChatMessage = sendChatMessage
    const runtime = createChatStoreRuntime(deps)
    try {
      expect(await runtime.sendMessage('Question')).toBe('reply')
      expect(sendChatMessage).toHaveBeenCalledOnce()
      expect(deps.invoke).toHaveBeenCalledWith('read_chat_image', {
        id: 'image-1',
        profileId: 'writer',
      })
    } finally {
      runtime.dispose()
    }
  })

  it('reports toast error when saving chat history fails', async () => {
    const history = createFakeHistory()
    // the question and the answer are both written, and both fail
    vi.mocked(history.saveChat).mockRejectedValue(new Error('disk full'))
    const toastKey = vi.fn()
    const input = reactive(createChatInputModel())

    const runtime = createChatStoreRuntime({
      profileId: null,
      invoke: vi.fn(async () => undefined) as unknown as typeof invokeDesktop,
      history,
      llmActions: {
        sendChatMessage: vi.fn(async () => chatAnswer('reply')),
        generateChatTitle: vi.fn(async () => ''),
      },
      editor: { value: '', selectedText: '' },
      input,
      getProfile: () => undefined,
      refreshProfile: vi.fn(async () => undefined),
      readSoul: vi.fn(async () => ''),
      updateProfileModel: vi.fn(async () => {}),
      getUserConfig: () => structuredClone(DEFAULT_USER_CONFIG),
      getSessionState: () => structuredClone(DEFAULT_SESSION_STATE),
      saveSessionState: vi.fn(async () => ({ success: true })),
      hasSecret: () => true,
      externalSelection: () => '',
      windowLabel: () => 'main',
      openMainChat: vi.fn(async () => {}),
      closeModals: vi.fn(),
      afterRender: vi.fn(async () => {}),
      navigateTo: vi.fn(async () => {}),
      translate: (key) => key,
      toastText: vi.fn(),
      toastKey,
      warn: vi.fn(),
    })

    input.setValue('Hello')
    await runtime.sendInput()
    await vi.waitFor(() => expect(runtime.isGenerating.value).toBe(false))

    await runtime.whenSaved()
    expect(history.saveChat).toHaveBeenCalledTimes(2)
    // a failing disk is told once, not for every write
    expect(toastKey).toHaveBeenCalledExactlyOnceWith(
      'history.operationFailed',
      'error'
    )
    runtime.dispose()
  })

  it('reports toast error when selecting model fails for a profile', async () => {
    const history = createFakeHistory()
    const toastText = vi.fn()
    const profile: AiProfile = {
      id: 'writer',
      name: 'Writer',
      memoryMode: 'auto',
      projectPermissions: {},
      createdAt: 1,
      updatedAt: 1,
    }

    const runtime = createChatStoreRuntime({
      profileId: 'writer',
      invoke: vi.fn(async () => undefined) as unknown as typeof invokeDesktop,
      history,
      llmActions: {
        sendChatMessage: vi.fn(async () => chatAnswer('reply')),
        generateChatTitle: vi.fn(async () => ''),
      },
      editor: { value: '', selectedText: '' },
      input: reactive(createChatInputModel()),
      getProfile: () => profile,
      refreshProfile: vi.fn(async () => profile),
      readSoul: vi.fn(async () => '# Soul'),
      updateProfileModel: vi.fn(async () => {
        throw new Error('vault locked')
      }),
      getUserConfig: () => structuredClone(DEFAULT_USER_CONFIG),
      getSessionState: () => structuredClone(DEFAULT_SESSION_STATE),
      saveSessionState: vi.fn(async () => ({ success: true })),
      hasSecret: () => true,
      externalSelection: () => '',
      windowLabel: () => 'main',
      openMainChat: vi.fn(async () => {}),
      closeModals: vi.fn(),
      afterRender: vi.fn(async () => {}),
      navigateTo: vi.fn(async () => {}),
      translate: (key) => key,
      toastText,
      toastKey: vi.fn(),
      warn: vi.fn(),
    })

    await runtime.selectModel('deepseek-chat')

    expect(toastText).toHaveBeenCalledWith(
      expect.stringContaining('toast.desktopCommandFailed'),
      'error'
    )
    runtime.dispose()
  })

  it('remembers the last chat of a profile across restarts', async () => {
    const profile: AiProfile = {
      id: 'writer',
      name: 'Writer',
      memoryMode: 'auto',
      projectPermissions: {},
      createdAt: 1,
      updatedAt: 1,
    }
    const invoke = vi.fn(async (command: string, args?: { id?: string }) =>
      command === 'get_chat'
        ? {
            id: args?.id,
            title: 'Stored',
            lastMessageAt: 1,
            messages: [{ role: 'user', content: 'question' }],
          }
        : undefined
    )
    const sessionState = {
      ...structuredClone(DEFAULT_SESSION_STATE),
      lastProfileChatIds: { other: 'chat-9', writer: 'chat-2' },
    }
    const saveSessionState = vi.fn(async () => ({ success: true }))

    const runtime = createChatStoreRuntime({
      profileId: 'writer',
      invoke: invoke as unknown as typeof invokeDesktop,
      history: createFakeHistory(),
      llmActions: {
        sendChatMessage: vi.fn(async () => chatAnswer('reply')),
        generateChatTitle: vi.fn(async () => ''),
      },
      editor: { value: '', selectedText: '' },
      input: reactive(createChatInputModel()),
      getProfile: () => profile,
      refreshProfile: vi.fn(async () => profile),
      readSoul: vi.fn(async () => '# Soul'),
      updateProfileModel: vi.fn(async () => {}),
      getUserConfig: () => structuredClone(DEFAULT_USER_CONFIG),
      getSessionState: () => sessionState,
      saveSessionState,
      hasSecret: () => true,
      externalSelection: () => '',
      windowLabel: () => 'main',
      openMainChat: vi.fn(async () => {}),
      closeModals: vi.fn(),
      afterRender: vi.fn(async () => {}),
      navigateTo: vi.fn(async () => {}),
      translate: (key) => key,
      toastText: vi.fn(),
      toastKey: vi.fn(),
      warn: vi.fn(),
    })

    await runtime.openLastOrNewChat()
    expect(runtime.currentChatParams.value.id).toBe('chat-2')
    // the chat stored already is not written again
    expect(saveSessionState).not.toHaveBeenCalled()

    await runtime.openChat('chat-3')
    expect(saveSessionState).toHaveBeenCalledWith({
      lastProfileChatIds: { writer: 'chat-3' },
    })
    runtime.dispose()
  })

  it('incorporates memory into instructions and reserves tool steps for active memory', async () => {
    const deps = runtimeDependencies('writer')
    vi.mocked(deps.invoke).mockImplementation(async (command) => {
      if (command === 'read_ai_profile_memory') return '# Core Memory\n- Fact'
      if (command === 'list_ai_profile_memory_topics') return []
      return []
    })
    const runtime = createChatStoreRuntime(deps)
    await runtime.openLastOrNewChat()

    deps.input.setValue('Hello')
    await runtime.sendInput()
    await vi.waitFor(() => expect(runtime.isGenerating.value).toBe(false))

    expect(deps.llmActions.sendChatMessage).toHaveBeenCalledWith(
      'Hello',
      [],
      expect.stringContaining('<profile_memory>'),
      expect.objectContaining({ modelId: 'ollama-qwen' })
    )
    runtime.dispose()
  })
})

it('suppresses state, navigation and focus from a load completed after disposal', async () => {
  const deps = runtimeDependencies('writer')
  let finish!: (value: unknown) => void
  deps.invoke = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  ) as unknown as typeof invokeDesktop
  const runtime = createChatStoreRuntime(deps)
  const opening = runtime.openChat('old')
  runtime.dispose()
  runtime.dispose()
  finish({ id: 'old', title: 'Old', lastMessageAt: 0, messages: [] })
  expect(await opening).toBe(false)
  expect(runtime.currentChatParams.value).toEqual({})
  expect(deps.saveSessionState).not.toHaveBeenCalled()
  expect(deps.navigateTo).not.toHaveBeenCalled()
  expect(deps.afterRender).not.toHaveBeenCalled()
  expect(deps.input.value).toBe('')
})

it('does not reopen a profile after disposal during preparation', async () => {
  const deps = runtimeDependencies('writer')
  let finish!: () => void
  deps.history.loadChatHistory = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  const runtime = createChatStoreRuntime(deps)
  const opening = runtime.openLastOrNewChat()
  runtime.dispose()
  finish()
  await opening
  expect(deps.navigateTo).not.toHaveBeenCalled()
  expect(deps.afterRender).not.toHaveBeenCalled()
  expect(runtime.currentChatParams.value).toEqual({})
})
