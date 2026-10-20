import {
  APP_CONFIG,
  type AiProfile,
  type ChatAttachment,
  type ChatSummary,
  type SessionState,
  type UserConfig,
} from '@tyco/shared'
import { computed, watch, type Ref } from 'vue'

import { LlmInstructionKind } from '../../types'
import { createDesktopChatTools } from '../chat-tools/desktop-chat-tools'
import type { invokeDesktop } from '../desktop/invoke'
import type { createChatHistoryModel } from '../history/chat-history'
import type { createLlmActions } from '../llm/llm-actions'
import { LlmError } from '../llm/llm-client'
import { normalizeLlmConfig } from '../llm/llm-config'
import { formatLlmError } from '../llm/llm-errors'
import type { AppRoutePath } from '../navigation/routes'
import {
  createChatController,
  type ChatControllerDependencies,
} from './chat-controller'
import { createChatDesktopFiles } from './chat-desktop-files'
import { isChatHistoryEnabled } from './chat-history-settings'
import { createChatImageStorage, getChatImage } from './chat-image-storage'
import {
  chatModelOptions,
  chatRequestBudgetCharacters,
  pickScopedChatModel,
  type ChatLlmOption,
} from './chat-llm-selection'
import { createChatModel } from './chat-model'
import { createChatProfileRuntime } from './chat-profile-runtime'

export type ChatStoreHistory = Omit<
  ReturnType<typeof createChatHistoryModel>,
  'chatHistory'
> & { chatHistory: Ref<ChatSummary[]> | ChatSummary[] }

export interface ChatStoreRuntimeDependencies {
  profileId: string | null
  invoke: typeof invokeDesktop
  history: ChatStoreHistory
  getFallbackProfileChatId?: () => string | undefined
  llmActions: Pick<
    ReturnType<typeof createLlmActions>,
    'sendChatMessage' | 'generateChatTitle'
  >
  editor: ChatControllerDependencies['editor']
  input: ChatControllerDependencies['input']
  getProfile: (id: string) => AiProfile | undefined
  refreshProfile: (id: string) => Promise<AiProfile | undefined>
  readSoul: (id: string) => Promise<string>
  updateProfileModel: (id: string, modelId: string) => Promise<unknown>
  getUserConfig: () => UserConfig | undefined
  getSessionState: () => SessionState | undefined
  saveSessionState: (
    patch: Partial<SessionState>
  ) => Promise<{ success: boolean; error?: string }>
  hasSecret: (providerId: string) => boolean
  externalSelection: () => string | null | undefined
  windowLabel: () => string
  openMainChat: (attachment: ChatAttachment | undefined) => Promise<unknown>
  closeModals: () => void
  afterRender: () => Promise<unknown>
  navigateTo: (path: AppRoutePath) => Promise<void>
  translate: (key: string, params?: Record<string, string | number>) => string
  toastText: (message: string, kind: 'error' | 'warn') => void
  toastKey: (key: string, kind: 'error' | 'warn') => void
  warn: (message: string) => void
}

/**
 * Composes the runtime models of a single chat ("Ask AI" when `profileId` is
 * null, or a profile chat).
 */
export function createChatStoreRuntime(deps: ChatStoreRuntimeDependencies) {
  const { profileId, history, translate, toastKey, toastText, warn } = deps
  const { storeChatImage, syncChatImages, loadChatWithImages } =
    createChatImageStorage({
      invoke: deps.invoke,
      createId: () => crypto.randomUUID(),
      profileId: profileId ?? undefined,
    })

  const profile = computed(() =>
    profileId ? deps.getProfile(profileId) : undefined
  )
  const { soul, lastProfileChatId, refreshProfile, prepareProfile } =
    createChatProfileRuntime({
      profileId,
      loadChatHistory: () => history.loadChatHistory(),
      refreshProfile: (id) => deps.refreshProfile(id),
      readSoul: (id) => deps.readSoul(id),
      warn,
    })

  const modelOptions = computed(() =>
    chatModelOptions(
      normalizeLlmConfig(deps.getUserConfig()?.llm),
      deps.hasSecret
    )
  )
  const selectedModel = computed<ChatLlmOption | null>(() =>
    pickScopedChatModel(modelOptions.value, {
      profileId,
      lastChatModelId: deps.getSessionState()?.lastChatModelId,
      profileModelId: profile.value?.modelId,
      profileMaxOutputTokens: profile.value?.maxOutputTokens,
    })
  )

  const getChatInstructions = () =>
    profileId ? soul.value : APP_CONFIG.aiInstructions[LlmInstructionKind.CHAT]
  const getChatRules = () =>
    profileId ? undefined : deps.getUserConfig()?.aiRules?.chat

  const requestBudgetCharacters = () => {
    const picked = selectedModel.value
    if (!picked) return 0
    return chatRequestBudgetCharacters(picked, {
      instructions: getChatInstructions(),
      rules: getChatRules(),
      rulePrefix: APP_CONFIG.rulePrefix,
    })
  }

  const chatTools = createDesktopChatTools({
    profileId,
    invoke: deps.invoke,
    canUseTools: () => selectedModel.value?.canUseTools ?? false,
    warn,
  })

  const model = createChatModel({
    sendChatMessage: async (
      message,
      prevMessages,
      instructions,
      { toolOutputBudgetCharacters, ...options }
    ) => {
      if (!profileId) {
        return deps.llmActions.sendChatMessage(
          message,
          prevMessages,
          instructions,
          {
            ...options,
            ...(await chatTools.turnTools(
              options.modelId,
              toolOutputBudgetCharacters
            )),
            rules: getChatRules(),
          }
        )
      }
      const stored = await refreshProfile()
      return deps.llmActions.sendChatMessage(
        message,
        prevMessages,
        soul.value,
        {
          ...options,
          ...(await chatTools.turnTools(
            options.modelId,
            toolOutputBudgetCharacters,
            stored?.tools
          )),
          temperature: stored?.temperature,
          maxOutputTokens: stored?.maxOutputTokens,
          loadImage: (id) => getChatImage(id, profileId),
        }
      )
    },
    generateChatTitle: deps.llmActions.generateChatTitle,
    saveChat: async (item) => {
      try {
        await history.saveChat(item)
      } catch (error) {
        toastKey('history.operationFailed', 'error')
        throw error
      }
    },
    renameChat: async (id, title) => {
      try {
        await history.renameChat(id, title)
      } catch (error) {
        toastKey('history.operationFailed', 'error')
        throw error
      }
    },
    loadChat: loadChatWithImages,
    navigateTo: deps.navigateTo,
    notifyError: (message) => {
      toastText(message, 'error')
    },
    emptyMessageError: () => translate('toast.textNotSelected'),
    emptyResponseError: () => translate('selection.emptyResult'),
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
    createId: () => crypto.randomUUID(),
    nowMs: () => Date.now(),
    // which chat to reopen is a convenience: a failure is only logged
    saveSessionState: async (patch) => {
      if (profileId) {
        if (patch.lastChatId) lastProfileChatId.value = patch.lastChatId
        return
      }
      const result = await deps.saveSessionState(patch)
      if (!result.success) warn(`Could not save the last chat: ${result.error}`)
    },
    getLastChatId: () =>
      profileId
        ? (lastProfileChatId.value ?? deps.getFallbackProfileChatId?.())
        : deps.getSessionState()?.lastChatId,
    isHistoryEnabled: () => {
      const config = deps.getUserConfig()
      return config ? isChatHistoryEnabled(config) : false
    },
    getChatModel: () => {
      const picked = selectedModel.value
      return picked
        ? {
            id: picked.id,
            canUseImages: picked.canUseImages,
            budgetCharacters: requestBudgetCharacters(),
            reservesToolSteps: chatTools.mayOfferTools({
              canUseTools: picked.canUseTools,
              settings: profileId ? profile.value?.tools : undefined,
            }),
          }
        : null
    },
  })

  // permissions given "for this session" end with the conversation
  watch(
    () => model.currentChatParams.value.id,
    () => chatTools.resetPermissions()
  )

  const files = createChatDesktopFiles({
    profileId,
    invoke: deps.invoke,
    storeImage: storeChatImage,
    syncImages: syncChatImages,
    imageQuality: () => deps.getUserConfig()?.chat.imageQuality,
    profileTools: () => profile.value?.tools,
    getDraft: () => model.currentChatParams.value,
    getMessages: () => model.messages.value,
    getSavingImages: () => model.savingImages.value,
    isGenerating: () => model.isGenerating.value,
    addAttachment: model.addAttachment,
    translate,
    toastText,
    toastKey,
    warn,
  })

  const controller = createChatController({
    model,
    files,
    editor: deps.editor,
    input: deps.input,
    selectedModel: () => selectedModel.value,
    requestBudgetCharacters,
    externalSelection: deps.externalSelection,
    windowLabel: deps.windowLabel,
    openMainChat: deps.openMainChat,
    closeModals: deps.closeModals,
    afterRender: deps.afterRender,
    // the picked model is read back from the state: unsaved, it is not picked
    selectModel: async (id) => {
      if (profileId) {
        try {
          await deps.updateProfileModel(profileId, id)
        } catch (error) {
          toastText(
            `${translate('toast.desktopCommandFailed')}: ${String(error)}`,
            'error'
          )
        }
        return
      }
      const result = await deps.saveSessionState({ lastChatModelId: id })
      if (!result.success)
        toastText(
          `${translate('toast.desktopCommandFailed')}: ${result.error ?? ''}`,
          'error'
        )
    },
  })

  const dispose = () => {
    chatTools.dispose()
    model.stopGeneration()
    files.dispose()
  }

  return {
    ...model,
    ...controller,
    /** The chat reopened in a profile is its last one, or a new one */
    async openLastOrNewChat() {
      if (profileId) await prepareProfile()
      await controller.openLastOrNewChat()
    },
    addFiles: files.addFiles,
    addDroppedFiles: files.addDroppedFiles,
    importingImages: files.importing,
    pendingImages: files.pendingImages,
    removeImage: files.removeImage,
    modelOptions,
    selectedModel,
    /** The tool calls of the answer that wait for the user */
    pendingToolApprovals: chatTools.pendingApprovals,
    answerToolApproval: chatTools.answerApproval,
    /** The profile this chat belongs to; null for "Ask AI" */
    profileId,
    /** The chats listed in the sidebar */
    history,
    dispose,
  }
}
