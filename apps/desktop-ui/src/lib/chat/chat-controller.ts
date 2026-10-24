import { computed, ref } from 'vue'
import {
  DESKTOP_WINDOW_LABELS,
  type ChatAttachment,
  type ChatAttachmentSource,
} from '@tyco/shared'

import { imageBudgetCharacters } from './chat-image-input'
import { attachmentTexts, inferAttachmentSource } from './chat-attachment'
import { resolveVoiceChatContext } from './editor-context'
import { resolveContextBudget } from './context-budget'
import {
  contextBudgetCharacters,
  type ChatLlmOption,
} from './chat-llm-selection'
import { trimChatContext } from './chat-context'
import type { createChatModel } from './chat-model'
import type { createChatFileController } from './chat-file-controller'

export interface ChatControllerDependencies {
  model: ReturnType<typeof createChatModel>
  files: Pick<
    ReturnType<typeof createChatFileController>,
    'pendingImages' | 'importing' | 'whileOpening'
  >
  editor: { value: string; selectedText: string }
  input: {
    value: string
    clear: () => void
    setValue: (text: string) => void
    requestFocus: () => void
  }
  selectedModel: () => ChatLlmOption | null
  requestBudgetCharacters?: () => number
  externalSelection: () => string | null | undefined
  windowLabel: () => string
  openMainChat: (attachment: ChatAttachment | undefined) => Promise<unknown>
  closeModals: () => void
  afterRender: () => Promise<unknown>
  selectModel: (id: string) => Promise<unknown>
}

/** Coordinates chat input, attached context, and window transitions. */
export function createChatController(deps: ChatControllerDependencies) {
  const { model, files, editor: editorInputStore, input: chatInputStore } = deps
  const selectedModel = computed(deps.selectedModel)
  const pendingImages = files.pendingImages
  const importingImages = files.importing
  /**
   * The editor selection made before the chat came into view: a question asked
   * by voice is not about it, see `resolveVoiceChatContext`
   */
  const staleEditorSelection = ref<string | null>(null)
  const markEditorSelectionStale = () => {
    staleEditorSelection.value = editorInputStore.selectedText.trim() || null
  }

  /** What goes with the next message besides the input */
  const attachedContext = computed<ChatAttachment[]>(
    () => model.currentChatParams.value.attachments || []
  )

  const requestBudgetCharacters = () => {
    const picked = selectedModel.value
    return (
      deps.requestBudgetCharacters?.() ??
      (picked
        ? contextBudgetCharacters(
            picked.contextWindowTokens,
            picked.maxOutputTokens
          )
        : 0)
    )
  }

  /** How much of the model the next message takes; null without a model */
  const contextBudget = computed(() => {
    const picked = selectedModel.value
    if (!picked) return null
    return resolveContextBudget(
      [...attachmentTexts(attachedContext.value), chatInputStore.value.trim()],
      requestBudgetCharacters(),
      (model.currentChatParams.value.images || []).reduce(
        (sum, image) => sum + imageBudgetCharacters(image),
        0
      )
    )
  })

  /** What a question asked by voice from the quick window is about */
  const voiceChatContext = computed(() =>
    resolveVoiceChatContext({
      externalSelection: deps.externalSelection(),
      editorSelection: editorInputStore.selectedText,
      staleSelection: staleEditorSelection.value,
    })
  )

  const historyImagesRequired = computed(() => {
    if (model.omitHistoryImages.value || !selectedModel.value) return false
    const inputSize = contextBudget.value?.usedCharacters || 0
    return trimChatContext(
      model.messages.value,
      Math.max(0, requestBudgetCharacters() - inputSize)
    ).some((message) => message.images?.length)
  })
  const imageModelRequired = computed(
    () =>
      !selectedModel.value?.canUseImages &&
      (pendingImages.value.length > 0 || historyImagesRequired.value)
  )
  /** Runs in the main window; the quick window hands the text over to it */
  const inMainWindow = async (attachment: ChatAttachment | undefined) => {
    if (deps.windowLabel() !== DESKTOP_WINDOW_LABELS.QUICK) return true
    await deps.openMainChat(attachment)
    return false
  }

  const startChat = async (params: Parameters<typeof model.startChat>[0]) => {
    deps.closeModals()
    if (!(await inMainWindow(params.attachments?.[0]))) return
    await model.startChat(params)
    await deps.afterRender()
    chatInputStore.requestFocus()
  }

  let inputSubmission = 0

  return {
    staleEditorSelection,
    attachedContext,
    contextBudget,
    voiceChatContext,
    imageModelRequired,
    markEditorSelectionStale,
    async selectModel(id: string) {
      await deps.selectModel(id)
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
            externalSelection: deps.externalSelection(),
            editorSelection: editorInputStore.selectedText,
            editorText: editorInputStore.value,
          }),
      }
      deps.closeModals()
      if (!(await inMainWindow(attachment))) return
      await model.attachToChat(attachment)
      await deps.afterRender()
      chatInputStore.requestFocus()
    },
    async openLastOrNewChat() {
      deps.closeModals()
      await files.whileOpening(() => model.openLastOrNewChat())
      await deps.afterRender()
      chatInputStore.requestFocus()
    },
    /** A new empty chat started from the chat itself */
    async startNewChat() {
      await startChat({})
      markEditorSelectionStale()
    },
    async openChat(id: string, options?: { silent?: boolean }) {
      deps.closeModals()
      const result = await files.whileOpening(() => model.openChat(id, options))
      // the editor selection has nothing to do with the opened conversation
      markEditorSelectionStale()
      await deps.afterRender()
      chatInputStore.requestFocus()
      return result
    },
    async branchChat(index: number) {
      deps.closeModals()
      const result = await model.branchChat(index)
      markEditorSelectionStale()
      await deps.afterRender()
      chatInputStore.requestFocus()
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
      const chatId = model.currentChatParams.value.id
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
          model.currentChatParams.value.id === chatId &&
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
}
