import {
  APP_CONFIG,
  type AiProfile,
  type ChatAttachment,
  type ChatSummary,
  type ChatsChangedEvent,
  type SessionState,
  type StorageChangedEvent,
  type UserConfig,
} from '@tyco/shared'
import { computed, watch, type Ref } from 'vue'

import { LlmInstructionKind } from '../../types'
import { changedChatFiles } from './chat-storage-changes'
import { createDesktopChatTools } from '../chat-tools/desktop-chat-tools'
import type { invokeDesktop } from '../desktop/invoke'
import type { createChatHistoryModel } from '../history/chat-history'
import type { createLlmActions } from '../llm/llm-actions'
import { LlmError } from '../llm/llm-client'
import { normalizeLlmConfig } from '../llm/llm-config'
import { describeError } from '../errors/describe-error'
import { formatLlmError } from '../llm/llm-errors'
import type { AppRoutePath } from '../navigation/routes'
import type { ToolLookup } from '../tools/tool-types'
import type { CommandEnvironment } from '../variables/command-variables'
import {
  createChatController,
  type ChatControllerDependencies,
} from './chat-controller'
import { createChatDesktopFiles } from './chat-desktop-files'
import { conversationAttachedFiles } from './chat-attached-files'
import { isChatHistoryEnabled } from './chat-history-settings'
import { createChatImageStorage } from './chat-image-storage'
import {
  chatModelOptions,
  chatRequestBudgetCharacters,
  pickScopedChatModel,
  type ChatLlmOption,
} from './chat-llm-selection'
import { createChatModel } from './chat-model'
import { createChatProfileRuntime } from './chat-profile-runtime'
import { profileTurnOptions } from './chat-profile-turn'
import { createChatRemoval } from './chat-removal'

type SendChatOptions = NonNullable<
  Parameters<ChatStoreRuntimeDependencies['llmActions']['sendChatMessage']>[3]
>

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
  /** Keeps the model picked in "Ask AI" in the settings */
  saveChatModelId: (
    modelId: string
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
  /** Tool registry to look up tools for custom commands in chat */
  tools?: ToolLookup
  /** The platform and variable values of this device */
  environment?: () => CommandEnvironment
  /** Waits before each retry of a failed chat write */
  saveRetryDelaysMs?: readonly number[]
  /** Hears every change of a chat history, from any window */
  listenStorageChanged?: (
    handler: (event: StorageChangedEvent) => void
  ) => Promise<() => void>
  listenChatsChanged?: (
    handler: (event: ChatsChangedEvent) => void
  ) => Promise<() => void>
}

/** How long a failed chat write waits before each retry */
const CHAT_SAVE_RETRY_DELAYS_MS = [1000, 5000] as const

/**
 * Composes the runtime models of a single chat ("Ask AI" when `profileId` is
 * null, or a profile chat).
 */
export function createChatStoreRuntime(deps: ChatStoreRuntimeDependencies) {
  const { profileId, history, translate, toastKey, toastText, warn } = deps
  const {
    storeChatImage,
    storeChatFile,
    syncChatImages,
    loadChatWithImages,
    loadImage,
  } = createChatImageStorage({
    invoke: deps.invoke,
    createId: () => crypto.randomUUID(),
    profileId: profileId ?? undefined,
  })

  const profile = computed(() =>
    profileId ? deps.getProfile(profileId) : undefined
  )
  const {
    soul,
    lastProfileChatId,
    memoryBlock,
    isCoreClipped,
    memoryWarnings,
    fullInstructions,
    refreshProfile,
    prepareProfile,
  } = createChatProfileRuntime({
    profileId,
    loadChatHistory: () => history.loadChatHistory(),
    refreshProfile: (id) => deps.refreshProfile(id),
    readSoul: (id) => deps.readSoul(id),
    readCoreMemory: (id) =>
      deps.invoke('read_ai_profile_memory', { profileId: id, file: 'core.md' }),
    listMemoryTopics: (id) =>
      deps.invoke('list_ai_profile_memory_topics', { profileId: id }),
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
      chatModelId: deps.getUserConfig()?.llm?.tasks.chat.modelId,
      profileModelId: profile.value?.modelId,
      profileMaxOutputTokens: profile.value?.maxOutputTokens,
    })
  )

  const chatTools = createDesktopChatTools({
    profileId,
    invoke: deps.invoke,
    canUseTools: () => selectedModel.value?.canUseTools ?? false,
    getMemoryMode: () => profile.value?.memoryMode,
    getChatId: () => model.currentChatParams.value.id,
    // the same names the prompt gives the model, see `buildLlmPrompt`
    getAttachedFiles: () =>
      conversationAttachedFiles(
        model.messages.value.flatMap((message) => message.attachments || [])
      ),
    getFetchMaxCharacters: () =>
      deps.getUserConfig()?.llm?.webSearch?.fetchMaxCharacters,
    warn,
    commands: () => deps.getUserConfig()?.commands ?? [],
    tools: deps.tools,
    environment: deps.environment,
  })

  /** What differs between "Ask AI" and a profile chat */
  interface ChatScope {
    instructions: () => string
    rules: () => string | undefined
    /** The call settings of one turn besides the model and the stream */
    turnOptions: (
      modelId: string,
      toolOutputBudgetCharacters: number | undefined
    ) => Promise<Partial<SendChatOptions>>
    saveLastChatId: (id: string | null) => Promise<void>
    getLastChatId: () => string | null | undefined
    /** Remembers the picked model; a failure is told to the user */
    selectModel: (id: string) => Promise<void>
  }

  const commandFailed = (detail: string) =>
    toastText(`${translate('toast.desktopCommandFailed')}${detail}`, 'error')

  const createAskAiScope = (): ChatScope => ({
    instructions: () => APP_CONFIG.aiInstructions[LlmInstructionKind.CHAT],
    rules: () => deps.getUserConfig()?.llm?.tasks.chat.rule,
    turnOptions: async (modelId, toolOutputBudgetCharacters) => ({
      ...(await chatTools.turnTools(modelId, toolOutputBudgetCharacters)),
      rules: deps.getUserConfig()?.llm?.tasks.chat.rule,
    }),
    saveLastChatId: async (lastChatId) => {
      const result = await deps.saveSessionState({ lastChatId })
      if (!result.success) warn(`Could not save the last chat: ${result.error}`)
    },
    getLastChatId: () => deps.getSessionState()?.lastChatId,
    selectModel: async (id) => {
      const result = await deps.saveChatModelId(id)
      if (!result.success) commandFailed(`: ${result.error ?? ''}`)
    },
  })

  /** The profile as the current turn read it, see `prepareTurn` */
  let turnProfile: AiProfile | undefined
  const createProfileScope = (id: string): ChatScope => ({
    instructions: () =>
      ['Current environment: chat.', fullInstructions.value]
        .filter(Boolean)
        .join('\n\n'),
    rules: () => undefined,
    turnOptions: async (modelId, toolOutputBudgetCharacters) => {
      return profileTurnOptions(
        chatTools,
        modelId,
        toolOutputBudgetCharacters,
        turnProfile ?? profile.value
      )
    },
    saveLastChatId: async (lastChatId) => {
      // an empty id forgets the profile's last chat
      const value = lastChatId ?? ''
      lastProfileChatId.value = value || null
      const stored = deps.getSessionState()?.lastProfileChatIds ?? {}
      if ((stored[id] ?? '') === value) return
      const result = await deps.saveSessionState({
        lastProfileChatIds: { [id]: value },
      })
      if (!result.success)
        warn(`Could not save the last profile chat: ${result.error}`)
    },
    getLastChatId: () =>
      lastProfileChatId.value ||
      deps.getSessionState()?.lastProfileChatIds?.[id] ||
      deps.getFallbackProfileChatId?.(),
    selectModel: async (modelId) => {
      try {
        await deps.updateProfileModel(id, modelId)
      } catch (error) {
        commandFailed(`\n${describeError(error, translate)}`)
      }
    },
  })

  const scope = profileId ? createProfileScope(profileId) : createAskAiScope()
  const getChatInstructions = scope.instructions
  const getChatRules = scope.rules

  const requestBudgetCharacters = () => {
    const picked = selectedModel.value
    if (!picked) return 0
    return chatRequestBudgetCharacters(picked, {
      instructions: getChatInstructions(),
      rules: getChatRules(),
      rulePrefix: APP_CONFIG.rulePrefix,
    })
  }

  /** The last write of the chat failed; the next failure is not told again */
  let saveFailed = false
  const isHistoryEnabled = () => {
    const config = deps.getUserConfig()
    return config ? isChatHistoryEnabled(config, profileId) : false
  }
  const model = createChatModel({
    // a profile reads its SOUL.md, memory and settings before the request is
    // measured, so the budget counts the instructions that are sent
    ...(profileId
      ? {
          prepareTurn: async () => {
            turnProfile = undefined
            turnProfile = await refreshProfile()
          },
        }
      : {}),
    sendChatMessage: async (
      message,
      prevMessages,
      _instructions,
      { toolOutputBudgetCharacters, ...options }
    ) => {
      const turnOptions = await scope.turnOptions(
        options.modelId,
        toolOutputBudgetCharacters
      )
      return deps.llmActions.sendChatMessage(
        message,
        prevMessages,
        scope.instructions(),
        { ...options, ...turnOptions, loadImage }
      )
    },
    generateChatTitle: deps.llmActions.generateChatTitle,
    saveRetryDelaysMs: deps.saveRetryDelaysMs ?? CHAT_SAVE_RETRY_DELAYS_MS,
    saveChat: async (item) => {
      // nothing is stored while the history is off: the chat stays in memory
      if (!isHistoryEnabled()) return
      try {
        await history.saveChat(item)
        saveFailed = false
      } catch (error) {
        // a turn writes more than once: a failing disk is told once
        if (!saveFailed) toastKey('history.operationFailed', 'error')
        saveFailed = true
        warn(
          `Could not save chat ${item.id}: ${describeError(error, translate)}`
        )
        throw error
      }
    },
    renameChat: async (id, title, options) => {
      try {
        await history.renameChat(id, title)
      } catch (error) {
        if (options?.silent)
          warn(
            `Could not rename chat ${id}: ${describeError(error, translate)}`
          )
        else toastKey('history.operationFailed', 'error')
        throw error
      }
    },
    loadChat: loadChatWithImages,
    navigateTo: deps.navigateTo,
    notifyError: (message) => {
      toastText(message, 'error')
    },
    emptyMessageError: () => translate('chat.emptyMessage'),
    emptyResponseError: () => translate('selection.emptyResult'),
    chatNotFoundError: () => translate('chat.notFound'),
    chatLoadError: () => translate('chat.loadFailed'),
    messageTooLongError: () => translate('llmErrors.contextLength'),
    noModelError: () => translate('chat.noModels'),
    toolsRequiredError: () => translate('llmErrors.toolsRequired'),
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
      if (patch.lastChatId === undefined) return
      // a chat that is not stored cannot be reopened
      if (patch.lastChatId !== null && !isHistoryEnabled()) return
      await scope.saveLastChatId(patch.lastChatId)
    },
    getLastChatId: scope.getLastChatId,
    isHistoryEnabled,
    getChatModel: () => {
      const picked = selectedModel.value
      return picked
        ? {
            id: picked.id,
            canUseImages: picked.canUseImages,
            canUseTools: picked.canUseTools,
            budgetCharacters: requestBudgetCharacters(),
            reservesToolSteps: chatTools.mayOfferTools({
              canUseTools: picked.canUseTools,
              settings: profileId ? profile.value?.tools : undefined,
              memoryMode: profileId ? profile.value?.memoryMode : undefined,
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
    invoke: deps.invoke,
    storeImage: storeChatImage,
    storeFile: storeChatFile,
    syncImages: syncChatImages,
    imageQuality: () => deps.getUserConfig()?.llm.imageQuality,
    getDraft: () => model.currentChatParams.value,
    getMessages: () => model.messages.value,
    getSavingImages: () => model.savingImages.value,
    getSavingFileIds: () => model.savingFileIds.value,
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
    selectModel: scope.selectModel,
  })

  const chatRemoval = createChatRemoval({
    history,
    chat: model,
    isHistoryEnabled,
    releaseImages: async (id) => {
      await deps.invoke('release_deleted_chat_images', { id })
    },
    reportError: (error) => {
      warn(
        `A chat history operation failed: ${describeError(error, translate)}`
      )
      toastKey('history.operationFailed', 'error')
    },
  })

  let disposed = false
  /**
   * Another window, the settings or the retention removed chats: the list is
   * read again, and a removed open chat is left rather than written back
   */
  const onChatsChanged = (event: ChatsChangedEvent) => {
    if (disposed || (event.profileId ?? null) !== profileId) return
    history
      .loadChatHistory()
      .catch((error) =>
        warn(`Could not reload the chats: ${describeError(error, translate)}`)
      )
    const openId = model.currentChatParams.value.id
    const isOpenRemoved =
      (event.isCleared && model.messages.value.length > 0) ||
      (openId !== undefined && event.removedChatIds.includes(openId))
    if (isOpenRemoved) model.abandonChat()
  }
  let stopStorageListening: (() => void) | undefined
  void deps
    .listenStorageChanged?.((event) => {
      if (disposed) return
      const files = changedChatFiles(event, profileId)
      if (!files.length) return
      void history.loadChatHistory().catch((error) => warn(String(error)))
      const id = model.currentChatParams.value.id
      if (
        id &&
        files.some(
          (file) => file === `${id}.json` || file.startsWith('images/')
        )
      ) {
        void model.reloadExternal().catch((error) => warn(String(error)))
      }
    })
    .then((stop) => {
      if (disposed) stop()
      else stopStorageListening = stop
    })
    .catch((error) => warn(String(error)))
  let stopListening: (() => void) | undefined
  void deps
    .listenChatsChanged?.(onChatsChanged)
    .then((stop) => {
      if (disposed) stop()
      else stopListening = stop
    })
    .catch((error) =>
      warn(`Could not follow chat changes: ${describeError(error, translate)}`)
    )

  const dispose = () => {
    if (disposed) return
    disposed = true
    stopListening?.()
    stopStorageListening?.()
    void chatRemoval.dispose()
    controller.dispose()
    chatTools.dispose()
    model.dispose()
    files.dispose()
  }

  return {
    ...model,
    ...controller,
    /** The chat reopened in a profile is its last one, or a new one */
    async openLastOrNewChat() {
      if (disposed) return
      if (profileId) await prepareProfile()
      if (disposed) return
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
    soul,
    memoryBlock,
    isCoreClipped,
    memoryWarnings,
    refreshProfile,
    /** The chats listed in the sidebar */
    history,
    /** The chat removed last, while its removal can be undone */
    removedChat: chatRemoval.removed,
    removeChat: chatRemoval.remove,
    undoRemoveChat: chatRemoval.undo,
    dispose,
  }
}
