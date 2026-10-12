import { createChatController } from '../lib/chat/chat-controller'
import {
  storeChatImage,
  syncChatImages,
  readDroppedChatFile,
  loadChatWithImages,
} from '../lib/chat/chat-image-storage'
import { type ChatFileErrorKind } from '../lib/chat/chat-file-input'
import { createChatFileController } from '../lib/chat/chat-file-controller'
import { createChatFileReader } from '../lib/chat/chat-file-reader'
import { formatLlmError } from '../lib/llm/llm-errors'
import { isSecretUsable } from '../lib/net/secrets'
import { LlmError } from '../lib/llm/llm-client'
import { defineStore } from 'pinia'
import { computed, nextTick, onScopeDispose, watch } from 'vue'
import { getDesktopWindowLabel } from '../lib/desktop/window'
import { useChatInputStore } from './chat-input'

import { useCallAi } from '../composables/use-call-ai'
import useToast from '../composables/use-toast'
import {
  chatModelOptions,
  contextBudgetCharacters,
  pickChatModel,
} from '../lib/chat/chat-model'
import { createChatStoreModel } from '../lib/chat/chat-store'
import { translate } from '../lib/i18n'
import { normalizeLlmConfig } from '../lib/llm/llm-config'
import { appNavigation } from '../lib/navigation/navigation'
import { useEditorInputStore } from './editor-input'
import { useHistoryStore } from './history'
import { useIpcStore } from './ipc'
import { useLlmStore } from './llm'
import { useMenuModalsStore } from './menu-modals'
import { makeUniqId } from '@/lib/squidlet-lib-local'

export const useChatStore = defineStore('chat', () => {
  const { toast } = useToast()
  const { sendChatMessage, generateChatTitle, saveLocalState } = useCallAi()
  const ipcStore = useIpcStore()
  const llmStore = useLlmStore()
  const historyStore = useHistoryStore()
  const editorInputStore = useEditorInputStore()
  const chatInputStore = useChatInputStore()
  const menuModalsStore = useMenuModalsStore()

  const modelOptions = computed(() =>
    chatModelOptions(
      normalizeLlmConfig(ipcStore.params.userConfig?.llm),
      (id) => isSecretUsable(llmStore.secrets, id)
    )
  )
  const selectedModel = computed(() =>
    pickChatModel(
      modelOptions.value,
      ipcStore.params.localState?.lastChatModelId
    )
  )

  const model = createChatStoreModel({
    sendChatMessage,
    generateChatTitle,
    saveChatHistory: async (item) => {
      try {
        await historyStore.saveChatHistory(item)
      } catch (error) {
        toast(translate('history.operationFailed'), 'error')
        throw error
      }
    },
    renameChat: async (id, title) => {
      try {
        await historyStore.renameChat(id, title)
      } catch (error) {
        toast(translate('history.operationFailed'), 'error')
        throw error
      }
    },
    loadChatHistoryItem: loadChatWithImages,
    navigateTo: (path) => appNavigation.push(path),
    notifyError: (message) => {
      toast(message, 'error')
    },
    emptyMessageError: () => translate('toast.textNotSelected'),
    chatNotFoundError: () => translate('history.empty'),
    messageTooLongError: () => translate('llmErrors.contextLength'),
    noModelError: () => translate('chat.noModels'),
    imageModelError: () => translate('chat.imageModelRequired'),
    imageTitle: () => translate('chat.imageTitle'),
    imageOmittedText: () => translate('chat.imageOmitted'),
    formatError: (error) =>
      error instanceof LlmError
        ? formatLlmError(error, translate)
        : String(error instanceof Error ? error.message : error),
    createId: () => makeUniqId(8),
    nowIso: () => new Date().toISOString(),
    saveLocalState: async (patch) => {
      await saveLocalState(patch)
    },
    getLastChatId: () => ipcStore.params.localState?.lastChatId,
    getChatModel: () => {
      const picked = selectedModel.value
      return picked
        ? {
            id: picked.id,
            vision: picked.vision,
            budgetCharacters: contextBudgetCharacters(picked.contextSize),
          }
        : null
    },
  })

  const fileErrorKeys: Record<ChatFileErrorKind, string> = {
    unsupported: 'chat.fileUnsupported',
    size: 'chat.fileSizeLimit',
    invalid: 'chat.fileInvalid',
    empty: 'chat.fileEmpty',
    textLimit: 'chat.fileTextLimit',
    imageLimit: 'chat.imageLimit',
    fileLimit: 'chat.fileCountLimit',
    pdfPages: 'chat.pdfPageLimit',
    password: 'chat.pdfPassword',
    memory: 'chat.imageMemoryLimit',
  }
  const files = createChatFileController({
    getDraft: () => model.newChatParams.value,
    getMessages: () => model.messages.value,
    getSavingImages: () => model.savingImages.value,
    isGenerating: () => model.isGenerating.value,
    prepare: createChatFileReader({
      quality: () => ipcStore.params.userConfig?.chatImageQuality || 'balanced',
      storeImage: storeChatImage,
    }),
    addAttachment: model.addAttachment,
    readDroppedFile: readDroppedChatFile,
    syncImages: syncChatImages,
    report: (name, kind) =>
      toast(`${name}: ${translate(fileErrorKeys[kind])}`, 'error'),
    notify: (name, notice) =>
      toast(
        `${name}: ${
          notice.kind === 'secrets'
            ? translate('chat.fileSecretsWarning')
            : translate('chat.pdfPagesSkipped', { count: notice.count })
        }`,
        'warn'
      ),
    reportSyncError: () => toast(translate('chat.imageUnavailable'), 'error'),
  })
  onScopeDispose(files.dispose)
  const controller = createChatController({
    model,
    files,
    editor: editorInputStore,
    input: chatInputStore,
    selectedModel: () => selectedModel.value,
    externalSelection: () => ipcStore.params.selectedText,
    windowLabel: getDesktopWindowLabel,
    openMainChat: (attachment) =>
      ipcStore.callFunctionOrNotify('openMainChat', [attachment]),
    closeModals: menuModalsStore.closeAll,
    afterRender: nextTick,
    selectModel: (id) => saveLocalState({ lastChatModelId: id }),
  })
  watch(
    () => ipcStore.params.isWindowShown,
    (isShown) => {
      if (!isShown) controller.markEditorSelectionStale()
    }
  )

  return {
    ...model,
    ...controller,
    addFiles: files.addFiles,
    addDroppedFiles: files.addDroppedFiles,
    importingImages: files.importing,
    pendingImages: files.pendingImages,
    removeImage: files.removeImage,
    modelOptions,
    selectedModel,
  }
})
