import { defineStore } from 'pinia'
import { computed, nextTick, ref, watch } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useChatInputStore } from './chatInput'

import { useCallAi } from '../composables/useCallAi'
import useToast from '../composables/useToast'
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
import { useEditorInputStore } from './editorInput'
import { useHistoryStore } from './history'
import { useIpcStore } from './ipc'
import { useLlmStore } from './llm'
import { useMenuModalsStore } from './menuModals'
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
      (id) => Object.hasOwn(llmStore.secrets, id)
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
    loadChatHistoryItem: (id) => historyStore.loadChat(id),
    navigateTo: (path) => appNavigation.push(path),
    notifyError: (message) => {
      toast(message, 'error')
    },
    emptyMessageError: () => translate('toast.textNotSelected'),
    chatNotFoundError: () => translate('history.empty'),
    messageTooLongError: () => translate('llmErrors.contextLength'),
    noModelError: () => translate('chat.noModels'),
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
      contextBudgetCharacters(picked.contextSize)
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

  return {
    ...model,
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
      await model.openLastOrNewChat()
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
      const result = await model.openChat(id, options)
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
      if (!message || model.isGenerating.value) return false
      const attachments = [...attachedContext.value]
      const pending = model.sendMessage(message, attachments)
      chatInputStore.clear()
      // a failed message goes back into the input
      if (!(await pending)) chatInputStore.setValue(message)
      return true
    },
  }
})
