import { type ChatParams } from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import type { invokeDesktop } from '../desktop/invoke'
import { createChatDesktopFiles } from './chat-desktop-files'

describe('chat-desktop-files', () => {
  it('saves dropped text files to workspace uploads when profile file tools are enabled', async () => {
    const draft = ref<ChatParams>({})
    const invoke = vi.fn(async (command: string) => {
      if (command === 'save_ai_upload') {
        return 'workspace/uploads/notes.txt'
      }
      return undefined
    }) as unknown as typeof invokeDesktop
    const addAttachment = vi.fn()
    const toastText = vi.fn()
    const toastKey = vi.fn()

    const files = createChatDesktopFiles({
      profileId: 'writer',
      invoke,
      storeImage: vi.fn(),
      syncImages: vi.fn(async () => undefined),
      imageQuality: () => 'balanced',
      profileTools: () => ({
        groups: { files: { isEnabled: true, access: 'allow' } },
      }),
      getDraft: () => draft.value,
      getMessages: () => [],
      getSavingImages: () => [],
      isGenerating: () => false,
      addAttachment,
      translate: (key) => key,
      toastText,
      toastKey,
      warn: vi.fn(),
    })

    await files.addFiles([
      new File(['hello world'], 'notes.txt', { type: 'text/plain' }),
    ])

    expect(invoke).toHaveBeenCalledWith('save_ai_upload', {
      bytes: expect.any(Uint8Array),
      meta: { profileId: 'writer', name: 'notes.txt' },
    })
    expect(addAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'notes.txt',
        workspacePath: 'workspace/uploads/notes.txt',
      })
    )
    files.dispose()
  })

  it('reports busy when adding files while generating', async () => {
    const draft = ref<ChatParams>({})
    const toastKey = vi.fn()

    const files = createChatDesktopFiles({
      profileId: null,
      invoke: vi.fn() as unknown as typeof invokeDesktop,
      storeImage: vi.fn(),
      syncImages: vi.fn(async () => undefined),
      imageQuality: () => 'balanced',
      profileTools: () => undefined,
      getDraft: () => draft.value,
      getMessages: () => [],
      getSavingImages: () => [],
      isGenerating: () => true,
      addAttachment: vi.fn(),
      translate: (key) => key,
      toastText: vi.fn(),
      toastKey,
      warn: vi.fn(),
    })

    await files.addFiles([
      new File(['hello'], 'notes.txt', { type: 'text/plain' }),
    ])

    expect(toastKey).toHaveBeenCalledWith('chat.filesWhileGenerating', 'warn')
    files.dispose()
  })
})
