import { type ChatConfig, type ProfileToolSettings } from '@tyco/shared'

import { FILES_TOOL_GROUP_ID } from '../chat-tools/chat-tool-groups'
import type { invokeDesktop } from '../desktop/invoke'
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
import { withWorkspaceUploads } from './chat-workspace-uploads'

export interface ChatDesktopFilesDependencies {
  profileId: string | null
  invoke: typeof invokeDesktop
  storeImage: ChatFileReaderDependencies['storeImage']
  syncImages: ChatFileControllerDependencies['syncImages']
  imageQuality: () => ChatConfig['imageQuality'] | undefined
  profileTools: () => ProfileToolSettings | undefined
  getDraft: ChatFileControllerDependencies['getDraft']
  getMessages: ChatFileControllerDependencies['getMessages']
  getSavingImages: ChatFileControllerDependencies['getSavingImages']
  isGenerating: ChatFileControllerDependencies['isGenerating']
  addAttachment: ChatFileControllerDependencies['addAttachment']
  translate: (key: string, params?: Record<string, string | number>) => string
  toastText: (message: string, kind: 'error' | 'warn') => void
  toastKey: (key: string, kind: 'error' | 'warn') => void
  warn: (message: string) => void
}

/**
 * Wires desktop file reading, workspace upload persistence, and the chat file
 * attachment controller.
 */
export function createChatDesktopFiles(deps: ChatDesktopFilesDependencies) {
  return createChatFileController({
    getDraft: deps.getDraft,
    getMessages: deps.getMessages,
    getSavingImages: deps.getSavingImages,
    isGenerating: deps.isGenerating,
    prepare: withWorkspaceUploads(
      createChatFileReader({
        quality: () => deps.imageQuality() || 'balanced',
        storeImage: deps.storeImage,
      }),
      {
        // only where the file tools could reach the kept file
        shouldKeep: () => {
          const group = deps.profileTools()?.groups[FILES_TOOL_GROUP_ID]
          return Boolean(group?.isEnabled && group.access !== 'deny')
        },
        saveUpload: async (file) =>
          deps.invoke('save_ai_upload', {
            bytes: new Uint8Array(await file.arrayBuffer()),
            meta: { profileId: deps.profileId ?? '', name: file.name },
          }),
        warn: deps.warn,
      }
    ),
    addAttachment: deps.addAttachment,
    readDroppedFile: readDroppedChatFile,
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
