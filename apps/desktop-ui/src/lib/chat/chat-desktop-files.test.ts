import { type ChatParams } from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import type { invokeDesktop } from '../desktop/invoke'
import { createChatDesktopFiles } from './chat-desktop-files'

describe('chat-desktop-files', () => {
  it('keeps the original of a dropped text file in any chat', async () => {
    const draft = ref<ChatParams>({})
    const invoke = vi.fn(async (command: string) => {
      if (command === 'read_dropped_file') {
        return [...new TextEncoder().encode('hello world')]
      }
      return undefined
    }) as unknown as typeof invokeDesktop
    const addAttachment = vi.fn()
    const toastText = vi.fn()
    const toastKey = vi.fn()

    const storeFile = vi.fn(async () => ({ id: 'a'.repeat(64), size: 11 }))
    const files = createChatDesktopFiles({
      invoke,
      storeImage: vi.fn(),
      storeFile,
      syncImages: vi.fn(async () => undefined),
      imageQuality: () => 'balanced',
      getDraft: () => draft.value,
      getMessages: () => [],
      getSavingImages: () => [],
      getSavingFileIds: () => [],
      isGenerating: () => false,
      addAttachment,
      translate: (key) => key,
      toastText,
      toastKey,
      warn: vi.fn(),
    })

    await files.addDroppedFiles(['/tmp/notes.txt'])

    expect(invoke).toHaveBeenCalledWith('read_dropped_file', {
      path: '/tmp/notes.txt',
    })

    expect(storeFile).toHaveBeenCalledWith(expect.any(Uint8Array))
    expect(addAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'notes.txt',
        file: { id: 'a'.repeat(64), size: 11 },
      })
    )
    files.dispose()
  })

  it('reports busy when adding files while generating', async () => {
    const draft = ref<ChatParams>({})
    const toastKey = vi.fn()

    const files = createChatDesktopFiles({
      invoke: vi.fn() as unknown as typeof invokeDesktop,
      storeImage: vi.fn(),
      storeFile: vi.fn(),
      syncImages: vi.fn(async () => undefined),
      imageQuality: () => 'balanced',
      getDraft: () => draft.value,
      getMessages: () => [],
      getSavingImages: () => [],
      getSavingFileIds: () => [],
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
