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
  let disposed = false
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
    if (disposed) return
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

  const focusAfterRender = async () => {
    if (disposed) return
    await deps.afterRender()
    if (!disposed) chatInputStore.requestFocus()
  }

  const startChat = async (params: Parameters<typeof model.startChat>[0]) => {
    if (disposed) return
    deps.closeModals()
    if (!(await inMainWindow(params.attachments?.[0]))) return
    await model.startChat(params)
    await focusAfterRender()
  }

  let inputSubmission = 0

  return {
    dispose: () => {
      disposed = true
    },
    staleEditorSelection,
    attachedContext,
    contextBudget,
    voiceChatContext,
    imageModelRequired,
    markEditorSelectionStale,
    async selectModel(id: string) {
      if (disposed) return
      await deps.selectModel(id)
    },
    startChat,
    /**
     * Gives a text to the chat; without a source, it is told by the text, see
     * `inferAttachmentSource`
     */
    async attachToChat(text: string, source?: ChatAttachmentSource) {
      if (disposed) return
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
      await focusAfterRender()
    },
    async openLastOrNewChat() {
      if (disposed) return
      deps.closeModals()
      await files.whileOpening(() => model.openLastOrNewChat())
      await focusAfterRender()
    },
    /** A new empty chat started from the chat itself */
    async startNewChat() {
      await startChat({})
      markEditorSelectionStale()
    },
    async openChat(id: string, options?: { silent?: boolean }) {
      if (disposed) return false
      deps.closeModals()
      const result = await files.whileOpening(() => model.openChat(id, options))
      if (disposed) return false
      // the editor selection has nothing to do with the opened conversation
      markEditorSelectionStale()
      await focusAfterRender()
      return result
    },
    async branchChat(index: number) {
      if (disposed) return false
      deps.closeModals()
      const result = await model.branchChat(index)
      if (disposed) return false
      markEditorSelectionStale()
      await focusAfterRender()
      return result
    },
    /** Sends the input; false when there is nothing to send or a reply runs */
    async sendInput(): Promise<boolean> {
      if (disposed) return false
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
      const chatId = model.currentChatParams.value.id
      // the chat tells when the question joined the conversation; a question
      // it never took (no model, too long) goes back to the input
      const accepted = new Promise<boolean>((resolve) => {
        model
          .sendMessage(message, attachments, [...pendingImages.value], {
            onAccepted: () => resolve(true),
          })
          .then(
            () => resolve(false),
            () => resolve(false)
          )
      })
      const messages = model.messages.value
      chatInputStore.clear()

      if (!(await accepted)) {
        if (
          !disposed &&
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
