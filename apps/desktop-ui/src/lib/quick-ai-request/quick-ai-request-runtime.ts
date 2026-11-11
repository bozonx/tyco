import {
  APP_CONFIG,
  llmSecretId,
  type AiProfile,
  type ProfileMemoryTopic,
  type UserConfig,
} from '@tyco/shared'
import { computed } from 'vue'

import { createDesktopChatTools } from '../chat-tools/desktop-chat-tools'
import type { ChatToolApprovalRequest } from '../chat-tools/chat-tool-loop'
import { isQuickRequestSavingEnabled } from '../chat/chat-history-settings'
import { chatModelOptions } from '../chat/chat-llm-selection'
import { resolveProfileInstructions } from '../chat/chat-profile-runtime'
import { profileTurnOptions } from '../chat/chat-profile-turn'
import type { invokeDesktop } from '../desktop/invoke'
import { describeError } from '../errors/describe-error'
import { resultOrThrow, type DesktopCall } from '../ipc/ipc-model'
import type { createLlmActions } from '../llm/llm-actions'
import { LlmError } from '../llm/llm-client'
import { normalizeLlmConfig, withPickedTaskModel } from '../llm/llm-config'
import { formatLlmError } from '../llm/llm-errors'
import { isSecretUsable, type SecretsStatus } from '../net/secrets'
import type { ToolLookup } from '../tools/tool-types'
import type { CommandEnvironment } from '../variables/command-variables'
import {
  createQuickAiRequestModel,
  type QuickAiRequestContext,
} from './quick-ai-request-model'
import { createQuickAiRequestSession } from './quick-ai-request-session'

export interface QuickAiRequestRuntimeDependencies {
  context: QuickAiRequestContext
  initialInputMode: 'text' | 'voice'
  initialProfileId: string | null

  invoke: typeof invokeDesktop
  /** Desktop calls that act for the activation, see `createIpcModel` */
  call: DesktopCall
  callOrNotify: DesktopCall
  llmActions: Pick<
    ReturnType<typeof createLlmActions>,
    'sendChatMessage' | 'generateChatTitle'
  >
  loadImage: (id: string) => Promise<Uint8Array<ArrayBuffer>>

  getUserConfig: () => UserConfig
  updateUserConfig: (
    patch: Partial<UserConfig>
  ) => Promise<{ success: boolean; error?: unknown }>
  getSecrets: () => SecretsStatus

  getProfile: (id: string) => AiProfile | undefined
  updateProfile: (id: string, patch: Partial<AiProfile>) => Promise<unknown>
  refreshProfile: (id: string) => Promise<AiProfile | undefined>
  readSoul: (id: string) => Promise<string>
  readMemory: (id: string, file: string) => Promise<string>
  listMemoryTopics: (id: string) => Promise<ProfileMemoryTopic[]>

  tools?: ToolLookup
  environment?: () => CommandEnvironment

  /** Keeps an answer the user took in the editor history */
  saveOutput: (text: string) => void
  toEditor: (text: string, sourceText?: string) => void
  closeOverlay: () => void

  translate: (key: string, params?: Record<string, string | number>) => string
  toastError: (message: string) => void
  warn: (message: string, scope: string) => void
  createId: () => string
}

/**
 * Composes one quick request: its session of tools, its model and the desktop
 * calls behind them. The turns are asked the way the main chat asks them, see
 * `profileTurnOptions` and `dev_docs/chat-files.md`
 */
export function createQuickAiRequestRuntime(
  deps: QuickAiRequestRuntimeDependencies
) {
  const { translate: t } = deps
  const quickRequestTask = () => deps.getUserConfig()?.llm?.tasks?.quickRequest
  const profileOf = (id: string | null) =>
    id ? deps.getProfile(id) : undefined

  /**
   * The conversation: its chat id, kept when it moves to the full chat, and its
   * tools, so that a call allowed "for this session" stays allowed for the
   * follow-up questions
   */
  const session = createQuickAiRequestSession({
    createId: deps.createId,
    createTools: ({
      chatId,
      profileId,
      profile,
    }: {
      chatId: string
      profileId: string | null
      profile?: AiProfile
    }) =>
      createDesktopChatTools({
        profileId,
        invoke: deps.invoke,
        canUseTools: () => true,
        getMemoryMode: () => profile?.memoryMode,
        getChatId: () => chatId,
        getAttachedFiles: () => model.attachedFiles(),
        getFetchMaxCharacters: () =>
          deps.getUserConfig()?.llm?.webSearch?.fetchMaxCharacters,
        warn: (message) => deps.warn(message, 'tools'),
        commands: () => deps.getUserConfig()?.commands ?? [],
        tools: deps.tools,
        environment: deps.environment,
      }),
  })
  const toolsOf = (profileId: string | null) =>
    session.toolsFor(profileId, profileOf(profileId))

  const rememberModelId = async (profileId: string | null, modelId: string) => {
    if (profileId) {
      try {
        await deps.updateProfile(profileId, { quickRequestModelId: modelId })
      } catch (error) {
        deps.toastError(describeError(error, t))
      }
      return
    }
    // "Ask AI" keeps its quick request model in the task settings
    const response = await deps.updateUserConfig({
      llm: withPickedTaskModel(
        normalizeLlmConfig(deps.getUserConfig()?.llm),
        'quickRequest',
        modelId
      ),
    })
    if (!response.success) deps.toastError(describeError(response.error, t))
  }

  const model = createQuickAiRequestModel({
    context: deps.context,
    initialInputMode: deps.initialInputMode,
    initialProfileId: deps.initialProfileId,
    getModelOptions: () =>
      chatModelOptions(normalizeLlmConfig(deps.getUserConfig()?.llm), (id) =>
        isSecretUsable(deps.getSecrets(), llmSecretId(id))
      ),
    getRememberedModelId: (profileId) =>
      profileOf(profileId)?.quickRequestModelId ||
      quickRequestTask()?.modelId ||
      undefined,
    rememberModelId,
    getRules: () => quickRequestTask()?.rule,
    resolveInstructions: async (profileId) =>
      [
        APP_CONFIG.aiInstructions.quickRequest,
        profileId
          ? await resolveProfileInstructions(profileId, {
              refreshProfile: deps.refreshProfile,
              readSoul: deps.readSoul,
              readCoreMemory: (id) => deps.readMemory(id, 'core.md'),
              listMemoryTopics: deps.listMemoryTopics,
              warn: (message) => deps.warn(message, 'profile'),
            })
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    mayOfferTools: (profileId) => {
      const profile = profileOf(profileId)
      return toolsOf(profileId).mayOfferTools({
        canUseTools: true,
        settings: profile?.tools,
        memoryMode: profile?.memoryMode,
      })
    },
    sendTurn: async (
      message,
      prevMessages,
      { profileId, instructions, toolOutputBudgetCharacters, ...options }
    ) => {
      const turn = await profileTurnOptions(
        toolsOf(profileId),
        options.modelId,
        toolOutputBudgetCharacters,
        profileOf(profileId)
      )
      return deps.llmActions.sendChatMessage(
        message,
        prevMessages,
        instructions,
        {
          ...options,
          ...turn,
          task: 'quickRequest',
          rules: quickRequestTask()?.rule,
          loadImage: deps.loadImage,
        }
      )
    },
    answerToolApproval: (approvalId, decision) =>
      session.currentTools()?.answerApproval(approvalId, decision),
    cancelToolApprovals: () => session.currentTools()?.dispose(),
    insertText: async (text) => {
      resultOrThrow(
        await deps.callOrNotify('paste_into_target_and_hide', { text }),
        'paste_into_target_and_hide'
      )
      deps.saveOutput(text)
    },
    toEditor: async (text, sourceText) => {
      deps.toEditor(text, sourceText)
      deps.saveOutput(text)
    },
    openMainChat: async (params) => {
      resultOrThrow(
        await deps.callOrNotify('open_main_chat', params),
        'open_main_chat'
      )
    },
    transferChat: async ({ chat, question, profileId }) => {
      resultOrThrow(
        await deps.call('open_transferred_chat', {
          transfer: {
            chat,
            question: question ?? null,
            profileId: profileId ?? null,
          },
        }),
        'open_transferred_chat'
      )
    },
    saveChat: async (chat, profileId) => {
      resultOrThrow(
        await deps.call('save_chat', { profileId, chat }),
        'save_chat'
      )
    },
    renameChat: async (id, title, profileId) => {
      resultOrThrow(
        await deps.call('rename_chat', { id, title, profileId }),
        'rename_chat'
      )
    },
    generateChatTitle: deps.llmActions.generateChatTitle,
    isQuickRequestSavingEnabled: (profileId) =>
      isQuickRequestSavingEnabled(deps.getUserConfig(), profileId),
    createId: deps.createId,
    chatId: session.chatId,
    closeOverlay: deps.closeOverlay,
    noModelError: () => t('quickAiRequest.noModel'),
    toolsRequiredError: () => t('llmErrors.toolsRequired'),
    imageModelError: () => t('chat.imageModelRequired'),
    messageTooLongError: () => t('llmErrors.contextLength'),
    emptyResponseError: () => t('selection.emptyResult'),
    imageTitle: () => t('chat.imageTitle'),
    imageOmittedText: () => t('chat.imageOmitted'),
    formatError: (error) =>
      error instanceof LlmError
        ? formatLlmError(error, t)
        : describeError(error, t),
  })

  /** The tool calls that wait for the user now, by their approval id */
  const pendingApprovals = computed(
    () =>
      new Map<string, ChatToolApprovalRequest>(
        (session.currentTools()?.pendingApprovals.value ?? []).map(
          (request) => [request.approvalId, request]
        )
      )
  )

  return {
    model,
    pendingApprovals,
    /** Ends the request: its answer stops, the calls waiting are cancelled */
    dispose: () => {
      if (model.isGenerating.value) model.stopGeneration()
      session.dispose()
    },
  }
}

export type QuickAiRequestRuntime = ReturnType<
  typeof createQuickAiRequestRuntime
>
