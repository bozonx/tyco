import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useChatStore } from './chat'

const mocks = vi.hoisted(() => ({
  label: 'main',
  callFunction: vi.fn().mockResolvedValue({ success: true }),
  startChat: vi.fn().mockResolvedValue(undefined),
  focus: vi.fn(),
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: mocks.label }),
}))
vi.mock('../composables/useCallAi', () => ({ useCallAi: () => ({}) }))
vi.mock('../composables/useToast', () => ({
  default: () => ({ toast: vi.fn() }),
}))
vi.mock('../lib/navigation/navigation', () => ({ appNavigation: {} }))
vi.mock('../lib/chat/chat-store', () => ({
  createChatStoreModel: () => ({ startChat: mocks.startChat }),
}))
vi.mock('./ipc', () => ({
  useIpcStore: () => ({
    callFunction: mocks.callFunction,
    callFunctionOrNotify: mocks.callFunction,
  }),
}))
vi.mock('./history', () => ({ useHistoryStore: () => ({}) }))
vi.mock('./chatInput', () => ({
  useChatInputStore: () => ({ focus: mocks.focus }),
}))

describe('chat window navigation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.label = 'main'
  })

  it('opens the chat with context and focuses its input', async () => {
    await useChatStore().startChat({ attachments: ['  context  '] })
    expect(mocks.startChat).toHaveBeenCalledWith({
      attachments: ['  context  '],
    })
    expect(mocks.focus).toHaveBeenCalledOnce()
    expect(mocks.callFunction).not.toHaveBeenCalled()
  })

  it('transfers context from the quick window to the main window', async () => {
    mocks.label = 'quick'
    await useChatStore().startChat({ attachments: ['  context  '] })
    expect(mocks.callFunction).toHaveBeenCalledWith('openMainChat', [
      '  context  ',
    ])
    expect(mocks.startChat).not.toHaveBeenCalled()
    expect(mocks.focus).not.toHaveBeenCalled()
  })
})
