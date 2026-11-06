import { type ChatAttachmentFile, type LlmImageQuality } from '@tyco/shared'

import type { invokeDesktop } from '../desktop/invoke'
import { withKeptOriginals } from './chat-attached-files'
import {
  createChatFileController,
  type ChatFileControllerDependencies,
} from './chat-file-controller'
import { CHAT_FILE_ERROR_KEYS, formatChatFileNotice } from './chat-file-error'
import {
  createChatFileReader,
  type ChatFileReaderDependencies,
} from './chat-file-reader'
import { readDroppedChatFile } from './chat-image-storage'

export interface ChatDesktopFilesDependencies {
  invoke: typeof invokeDesktop
  storeImage: ChatFileReaderDependencies['storeImage']
  /** Keeps the original of an attached file */
  storeFile: (bytes: Uint8Array<ArrayBuffer>) => Promise<ChatAttachmentFile>
  syncImages: ChatFileControllerDependencies['syncImages']
  imageQuality: () => LlmImageQuality | undefined
  getDraft: ChatFileControllerDependencies['getDraft']
  getMessages: ChatFileControllerDependencies['getMessages']
  getSavingImages: ChatFileControllerDependencies['getSavingImages']
  getSavingFileIds: ChatFileControllerDependencies['getSavingFileIds']
  isGenerating: ChatFileControllerDependencies['isGenerating']
  addAttachment: ChatFileControllerDependencies['addAttachment']
  translate: (key: string, params?: Record<string, string | number>) => string
  toastText: (message: string, kind: 'error' | 'warn') => void
  toastKey: (key: string, kind: 'error' | 'warn') => void
  warn: (message: string) => void
}

/**
 * Wires desktop file reading, the originals kept with the conversation, and the
 * chat file attachment controller.
 */
export function createChatDesktopFiles(deps: ChatDesktopFilesDependencies) {
  return createChatFileController({
    getDraft: deps.getDraft,
    getMessages: deps.getMessages,
    getSavingImages: deps.getSavingImages,
    getSavingFileIds: deps.getSavingFileIds,
    isGenerating: deps.isGenerating,
    prepare: withKeptOriginals(
      createChatFileReader({
        quality: () => deps.imageQuality() || 'balanced',
        storeImage: deps.storeImage,
      }),
      {
        storeFile: async (file) =>
          deps.storeFile(new Uint8Array(await file.arrayBuffer())),
        warn: deps.warn,
      }
    ),
    addAttachment: deps.addAttachment,
    readDroppedFile: (path) => readDroppedChatFile(path, deps.invoke),
    syncImages: deps.syncImages,
    report: (name, kind) =>
      deps.toastText(
        `${name}: ${deps.translate(CHAT_FILE_ERROR_KEYS[kind])}`,
        'error'
      ),
    notify: (name, notice) =>
      deps.toastText(
        formatChatFileNotice(name, notice, deps.translate),
        'warn'
      ),
    reportSyncError: () => deps.toastKey('chat.imageUnavailable', 'error'),
    reportBusy: () => deps.toastKey('chat.filesWhileGenerating', 'warn'),
  })
}
