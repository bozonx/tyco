import { imageBudgetCharacters } from '../lib/chat/chat-image-input'
import {
  storeChatImage,
  syncChatImages,
  readDroppedChatFile,
  loadChatWithImages,
} from '../lib/chat/chat-image-storage'
import { type ChatFileErrorKind } from '../lib/chat/chat-file-input'
import { createChatFileController } from '../lib/chat/chat-file-controller'
import { createChatFileReader } from '../lib/chat/chat-file-reader'
import { trimChatContext } from '../lib/chat/chat-helpers'
import { formatLlmError } from '../lib/llm/llm-errors'
import { isSecretUsable } from '../lib/net/secrets'
import { LlmError } from '../lib/llm/llm-client'
import { defineStore } from 'pinia'
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import { getDesktopWindow as getCurrentWindow } from '../lib/desktop/window'
import { useChatInputStore } from './chat-input'

import { useCallAi } from '../composables/use-call-ai'
import useToast from '../composables/use-toast'
import {
  chatModelOptions,
  contextBudgetCharacters,
  pickChatModel,
} from '../lib/chat/chat-model'
import { createChatStoreModel } from '../lib/chat/chat-store'
import {
  attachmentTexts,
  inferAttachmentSource,
} from '../lib/chat/chat-attachment'
import { resolveContextBudget } from '../lib/chat/context-budget'
import {
  resolveEditorContext,
  resolveVoiceChatContext,
} from '../lib/chat/editor-context'
import { translate } from '../lib/i18n'
import { normalizeLlmConfig } from '../lib/llm/llm-config'
import { appNavigation } from '../lib/navigation/navigation'
import { useEditorInputStore } from './editor-input'
import { useHistoryStore } from './history'
import { useIpcStore } from './ipc'
import { useLlmStore } from './llm'
import { useMenuModalsStore } from './menu-modals'
import { makeUniqId } from '@/lib/squidlet-lib-local'
import type { ChatAttachment, ChatAttachmentSource } from '@tyco/shared'

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

  /**
   * The editor selection made before the chat came into view: it is only
   * suggested, see `resolveEditorContext`
   */
  const staleEditorSelection = ref<string | null>(null)
  const markEditorSelectionStale = () => {
    staleEditorSelection.value = editorInputStore.selectedText.trim() || null
  }
  // the editor of a hidden window keeps the selection of its last use
  watch(
    () => ipcStore.params.isWindowShown,
    (isShown) => {
      if (!isShown) markEditorSelectionStale()
    }
  )

  /** What the editor offers to the next message */
  const editorContext = computed(() =>
    model.newChatParams.value.withoutEditorContext
      ? null
      : resolveEditorContext({
          editorText: editorInputStore.value,
          selectedText: editorInputStore.selectedText,
          messages: model.messages.value,
          pendingAttachments: model.newChatParams.value.attachments || [],
          dismissed: model.dismissedEditorContext.value,
          accepted: model.acceptedEditorContext.value,
          staleSelection: staleEditorSelection.value,
        })
  )

  /** What goes with the next message besides the input */
  const attachedContext = computed<ChatAttachment[]>(() => {
    const context = editorContext.value
    return [
      ...(model.newChatParams.value.attachments || []),
      ...(context?.mode === 'attached'
        ? [{ text: context.text, source: context.source }]
        : []),
    ]
  })

  /** How much of the model the next message takes; null without a model */
  const contextBudget = computed(() => {
    const picked = selectedModel.value
    if (!picked) return null
    return resolveContextBudget(
      [...attachmentTexts(attachedContext.value), chatInputStore.value.trim()],
      contextBudgetCharacters(picked.contextSize),
      (model.newChatParams.value.images || []).reduce(
        (sum, image) => sum + imageBudgetCharacters(image),
        0
      )
    )
  })

  /** What a question asked by voice from the quick window is about */
  const voiceChatContext = computed(() =>
    resolveVoiceChatContext({
      externalSelection: ipcStore.params.selectedText,
      editorSelection: editorInputStore.selectedText,
      staleSelection: staleEditorSelection.value,
    })
  )

  /** Runs in the main window; the quick window hands the text over to it */
  const inMainWindow = async (attachment: ChatAttachment | undefined) => {
    if (getCurrentWindow().label !== 'quick') return true
    await ipcStore.callFunctionOrNotify('openMainChat', [attachment])
    return false
  }

  const startChat = async (params: Parameters<typeof model.startChat>[0]) => {
    menuModalsStore.closeAll()
    if (!(await inMainWindow(params.attachments?.[0]))) return
    await model.startChat(params)
    await nextTick()
    chatInputStore.focus()
  }

  const historyImagesRequired = computed(() => {
    if (model.omitHistoryImages.value || !selectedModel.value) return false
    const inputSize = contextBudget.value?.used || 0
    return trimChatContext(
      model.messages.value,
      Math.max(
        0,
        contextBudgetCharacters(selectedModel.value.contextSize) - inputSize
      )
    ).some((message) => message.images?.length)
  })
  const imageModelRequired = computed(
    () =>
      !selectedModel.value?.vision &&
      (pendingImages.value.length > 0 || historyImagesRequired.value)
  )
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
  const importingImages = files.importing
  const pendingImages = files.pendingImages

  let inputSubmission = 0

  return {
    ...model,
    addFiles: files.addFiles,
    addDroppedFiles: files.addDroppedFiles,
    importingImages,
    pendingImages,
    imageModelRequired,
    removeImage: files.removeImage,
    modelOptions,
    selectedModel,
    editorContext,
    attachedContext,
    contextBudget,
    voiceChatContext,
    async selectModel(id: string) {
      await saveLocalState({ lastChatModelId: id })
    },
    startChat,
    /**
     * Gives a text to the chat; without a source, it is told by the text, see
     * `inferAttachmentSource`
     */
    async attachToChat(text: string, source?: ChatAttachmentSource) {
      const attachment: ChatAttachment = {
        text,
        source:
          source ??
          inferAttachmentSource(text, {
            externalSelection: ipcStore.params.selectedText,
            editorSelection: editorInputStore.selectedText,
            editorText: editorInputStore.value,
          }),
      }
      menuModalsStore.closeAll()
      if (!(await inMainWindow(attachment))) return
      await model.attachToChat(attachment)
      await nextTick()
      chatInputStore.focus()
    },
    async openLastOrNewChat() {
      menuModalsStore.closeAll()
      await files.whileOpening(() => model.openLastOrNewChat())
      await nextTick()
      chatInputStore.focus()
    },
    /** A new empty chat started from the chat itself */
    async startNewChat() {
      await startChat({})
      markEditorSelectionStale()
    },
    async openChat(id: string, options?: { silent?: boolean }) {
      menuModalsStore.closeAll()
      const result = await files.whileOpening(() => model.openChat(id, options))
      // the editor selection has nothing to do with the opened conversation
      markEditorSelectionStale()
      await nextTick()
      chatInputStore.focus()
      return result
    },
    async branchChat(index: number) {
      menuModalsStore.closeAll()
      const result = await model.branchChat(index)
      markEditorSelectionStale()
      await nextTick()
      chatInputStore.focus()
      return result
    },
    /** Sends the input; false when there is nothing to send or a reply runs */
    async sendInput(): Promise<boolean> {
      const message = chatInputStore.value.trim()
      if (
        (!message &&
          !pendingImages.value.length &&
          !attachedContext.value.length) ||
        model.isGenerating.value ||
        importingImages.value
      )
        return false
      const attachments = [...attachedContext.value]
      const submission = ++inputSubmission
      const initialMessageCount = model.messages.value.length
      const pending = model.sendMessage(message, attachments, [
        ...pendingImages.value,
      ])
      const chatId = model.newChatParams.value.id
      const messages = model.messages.value
      chatInputStore.clear()

      // Restore only if the request could not be sent (e.g. no model or exceeded budget).
      // Once the request is dispatched to the chat, it stays in the conversation and must not
      // be restored into the input upon completion or failure of the assistant turn.
      const dispatched =
        model.messages.value.length > initialMessageCount ||
        model.isGenerating.value

      if (!dispatched) {
        await pending
        if (
          submission === inputSubmission &&
          model.newChatParams.value.id === chatId &&
          model.messages.value === messages &&
          !chatInputStore.value
        ) {
          chatInputStore.setValue(message)
        }
        return false
      }
      return true
    },
  }
})
