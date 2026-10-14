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
import { isChatHistoryEnabled } from '../lib/chat/chat-history-settings'
import { formatLlmError } from '../lib/llm/llm-errors'
import { isSecretUsable } from '../lib/net/secrets'
import { LlmError } from '../lib/llm/llm-client'
import { APP_CONFIG } from '@tyco/shared'
import { LlmInstructionKind } from '../types'
import { defineStore } from 'pinia'
import { computed, nextTick, onScopeDispose, watch } from 'vue'
import { getDesktopWindowLabel } from '../lib/desktop/window'
import { useChatInputStore } from './chat-input'

import { useLlmActions } from '../composables/use-llm-actions'
import useToast from '../composables/use-toast'
import {
  chatModelOptions,
  chatRequestBudgetCharacters,
  pickChatModel,
} from '../lib/chat/chat-model'
import { createChatModel } from '../lib/chat/chat-store'
import { translate } from '../lib/i18n'
import { clientLogger } from '../lib/logger'
import { normalizeLlmConfig } from '../lib/llm/llm-config'
import { appNavigation } from '../lib/navigation/navigation'
import { useEditorInputStore } from './editor-input'
import { useHistoryStore } from './history'
import { useIpcStore } from './ipc'
import { useLlmStore } from './llm'
import { useMenuModalsStore } from './menu-modals'
import { createRuntimeId } from '@/lib/runtime-id'

export const useChatStore = defineStore('chat', () => {
  const { toast, toastText } = useToast()
  const { sendChatMessage, generateChatTitle } = useLlmActions()
  const ipcStore = useIpcStore()
  const saveSessionState = ipcStore.patchSessionState
  const llmStore = useLlmStore()
  const historyStore = useHistoryStore()
  const editorInputStore = useEditorInputStore()
  const chatInputStore = useChatInputStore()
  const menuModalsStore = useMenuModalsStore()

  const modelOptions = computed(() =>
    chatModelOptions(
      normalizeLlmConfig(ipcStore.desktopState.userConfig?.llm),
      (id) => isSecretUsable(llmStore.secrets, id)
    )
  )
  const selectedModel = computed(() =>
    pickChatModel(
      modelOptions.value,
      ipcStore.desktopState.sessionState?.lastChatModelId
    )
  )

  const getChatInstructions = () =>
    (ipcStore.desktopState.appConfig ?? APP_CONFIG).aiInstructions[
      LlmInstructionKind.CHAT
    ]
  const requestBudgetCharacters = () => {
    const picked = selectedModel.value
    if (!picked) return 0
    return chatRequestBudgetCharacters(picked, {
      instructions: getChatInstructions(),
      rules: ipcStore.desktopState.userConfig.aiRules?.chat,
      rulePrefix: (ipcStore.desktopState.appConfig ?? APP_CONFIG).rulePrefix,
    })
  }

  const model = createChatModel({
    sendChatMessage,
    generateChatTitle,
    saveChat: async (item) => {
      try {
        await historyStore.saveChat(item)
      } catch (error) {
        toast('history.operationFailed', 'error')
        throw error
      }
    },
    renameChat: async (id, title) => {
      try {
        await historyStore.renameChat(id, title)
      } catch (error) {
        toast('history.operationFailed', 'error')
        throw error
      }
    },
    loadChat: loadChatWithImages,
    navigateTo: (path) => appNavigation.push(path),
    notifyError: (message) => {
      toastText(message, 'error')
    },
    emptyMessageError: () => translate('toast.textNotSelected'),
    chatNotFoundError: () => translate('history.empty'),
    chatLoadError: () => translate('history.operationFailed'),
    messageTooLongError: () => translate('llmErrors.contextLength'),
    noModelError: () => translate('chat.noModels'),
    imageModelError: () => translate('chat.imageModelRequired'),
    imageTitle: () => translate('chat.imageTitle'),
    branchTitle: (title) => translate('chat.branchTitle', { title }),
    getChatInstructions,
    imageOmittedText: () => translate('chat.imageOmitted'),
    formatError: (error) =>
      error instanceof LlmError
        ? formatLlmError(error, translate)
        : String(error instanceof Error ? error.message : error),
    createId: () => createRuntimeId(),
    nowIso: () => new Date().toISOString(),
    // which chat to reopen is a convenience: a failure is only logged
    saveSessionState: async (patch) => {
      const result = await saveSessionState(patch)
      if (!result.success)
        clientLogger.warn(
          `Could not save the last chat: ${result.error}`,
          'chat'
        )
    },
    getLastChatId: () => ipcStore.desktopState.sessionState?.lastChatId,
    isHistoryEnabled: () =>
      isChatHistoryEnabled(ipcStore.desktopState.userConfig),
    getChatModel: () => {
      const picked = selectedModel.value
      return picked
        ? {
            id: picked.id,
            canUseImages: picked.canUseImages,
            budgetCharacters: requestBudgetCharacters(),
          }
        : null
    },
  })

  onScopeDispose(model.stopGeneration)

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
    getDraft: () => model.currentChatState.value,
    getMessages: () => model.messages.value,
    getSavingImages: () => model.savingImages.value,
    isGenerating: () => model.isGenerating.value,
    prepare: createChatFileReader({
      quality: () =>
        ipcStore.desktopState.userConfig?.chatImageQuality || 'balanced',
      storeImage: storeChatImage,
    }),
    addAttachment: model.addAttachment,
    readDroppedFile: readDroppedChatFile,
    syncImages: syncChatImages,
    report: (name, kind) =>
      toastText(`${name}: ${translate(fileErrorKeys[kind])}`, 'error'),
    notify: (name, notice) =>
      toastText(
        `${name}: ${
          notice.kind === 'secrets'
            ? translate('chat.fileSecretsWarning')
            : translate('chat.pdfPagesSkipped', { count: notice.count })
        }`,
        'warn'
      ),
    reportSyncError: () => toast('chat.imageUnavailable', 'error'),
  })
  onScopeDispose(files.dispose)
  const controller = createChatController({
    model,
    files,
    editor: editorInputStore,
    input: chatInputStore,
    selectedModel: () => selectedModel.value,
    requestBudgetCharacters,
    externalSelection: () => ipcStore.desktopState.selectedText,
    windowLabel: getDesktopWindowLabel,
    openMainChat: (attachment) =>
      ipcStore.callFunctionOrNotify('openMainChat', [attachment]),
    closeModals: menuModalsStore.closeAll,
    afterRender: nextTick,
    // the picked model is read back from the state: unsaved, it is not picked
    selectModel: async (id) => {
      const result = await saveSessionState({ lastChatModelId: id })
      if (!result.success)
        toastText(
          `${translate('toast.desktopCommandFailed')}: ${result.error ?? ''}`,
          'error'
        )
    },
  })
  watch(
    () => ipcStore.desktopState.isWindowShown,
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
