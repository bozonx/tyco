import { DEFAULT_USER_CONFIG, type AiProfile } from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'

import type { invokeDesktop } from '../desktop/invoke'
import { createChatInputModel } from './chat-input-model'
import {
  createChatStoreRuntime,
  type ChatStoreHistory,
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

describe('chat-store-runtime', () => {
  it('reports toast error when saving chat history fails', async () => {
    const history = createFakeHistory()
    vi.mocked(history.saveChat).mockRejectedValueOnce(new Error('disk full'))
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
      getSessionState: () => ({}),
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

    expect(toastKey).toHaveBeenCalledWith('history.operationFailed', 'error')
    runtime.dispose()
  })

  it('reports toast error when selecting model fails for a profile', async () => {
    const history = createFakeHistory()
    const toastText = vi.fn()
    const profile: AiProfile = {
      id: 'writer',
      name: 'Writer',
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
      getSessionState: () => ({}),
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
})
