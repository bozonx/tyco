import { defineStore } from 'pinia'
import { computed, nextTick } from 'vue'
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
import { resolveEditorContext } from '../lib/chat/editor-context'
import { translate } from '../lib/i18n'
import { normalizeLlmConfig } from '../lib/llm/llm-config'
import { appNavigation } from '../lib/navigation/navigation'
import { useEditorInputStore } from './editorInput'
import { useHistoryStore } from './history'
import { useIpcStore } from './ipc'
import { useLlmStore } from './llm'
import { useMenuModalsStore } from './menuModals'
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
        })
  )

  /** Runs in the main window; the quick window hands the text over to it */
  const inMainWindow = async (text: string | undefined) => {
    if (getCurrentWindow().label !== 'quick') return true
    await ipcStore.callFunctionOrNotify('openMainChat', [text])
    return false
  }

  return {
    ...model,
    modelOptions,
    selectedModel,
    editorContext,
    async selectModel(id: string) {
      await saveLocalState({ lastChatModelId: id })
    },
    async startChat(params: Parameters<typeof model.startChat>[0]) {
      menuModalsStore.closeAll()
      if (!(await inMainWindow(params.attachments?.[0]))) return
      await model.startChat(params)
      await nextTick()
      chatInputStore.focus()
    },
    /** Gives a text selected elsewhere to the chat */
    async attachToChat(text: string) {
      menuModalsStore.closeAll()
      if (!(await inMainWindow(text))) return
      await model.attachToChat(text)
      await nextTick()
      chatInputStore.focus()
    },
    async openLastOrNewChat() {
      menuModalsStore.closeAll()
      await model.openLastOrNewChat()
      await nextTick()
      chatInputStore.focus()
    },
    async openChat(id: string, options?: { silent?: boolean }) {
      menuModalsStore.closeAll()
      const result = await model.openChat(id, options)
      await nextTick()
      chatInputStore.focus()
      return result
    },
    async branchChat(index: number) {
      menuModalsStore.closeAll()
      const result = await model.branchChat(index)
      await nextTick()
      chatInputStore.focus()
      return result
    },
    /** Sends the input; false when there is nothing to send or a reply runs */
    async sendInput(): Promise<boolean> {
      const message = chatInputStore.value.trim()
      if (!message || model.isGenerating.value) return false
      const attachments = [
        ...(model.newChatParams.value?.attachments || []),
        ...(editorContext.value ? [editorContext.value.text] : []),
      ]
      const pending = model.sendMessage(message, attachments)
      chatInputStore.clear()
      // a failed message goes back into the input
      if (!(await pending)) chatInputStore.setValue(message)
      return true
    },
  }
})
