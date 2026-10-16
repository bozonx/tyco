import { invokeDesktop } from '../lib/desktop/invoke'
import { createChatController } from '../lib/chat/chat-controller'
import {
  readDroppedChatFile,
  createChatImageStorage,
  getChatImage,
} from '../lib/chat/chat-image-storage'
import { type ChatFileErrorKind } from '../lib/chat/chat-file-input'
import { createChatFileController } from '../lib/chat/chat-file-controller'
import { createChatFileReader } from '../lib/chat/chat-file-reader'
import { isChatHistoryEnabled } from '../lib/chat/chat-history-settings'
import { createIpcChatSessionStorageDriver } from '../lib/chat/chat-session-storage'
import { createChatHistoryModel } from '../lib/history/chat-history'
import { formatLlmError } from '../lib/llm/llm-errors'
import { isSecretUsable } from '../lib/net/secrets'
import { LlmError } from '../lib/llm/llm-client'
import { APP_CONFIG, type ProfileToolSettings } from '@tyco/shared'
import { LlmInstructionKind } from '../types'
import { defineStore, getActivePinia, type Pinia } from 'pinia'
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import { getDesktopWindowLabel } from '../lib/desktop/window'
import { useChatInputStore, useProfileChatInputStore } from './chat-input'
import { useAiProfilesStore } from './ai-profiles'

import useToast from '../composables/use-toast'
import {
  chatModelOptions,
  chatRequestBudgetCharacters,
  pickChatModel,
  type ChatLlmOption,
} from '../lib/chat/chat-llm-selection'
import { createChatModel } from '../lib/chat/chat-model'
import { createChatToolsSession } from '../lib/chat-tools/chat-tools-session'
import {
  createDebugChatToolProvider,
  isDebugChatToolsEnabled,
} from '../lib/chat-tools/debug-chat-tools'
import { translate } from '../lib/i18n'
import { clientLogger } from '../lib/logger'
import { normalizeLlmConfig } from '../lib/llm/llm-config'
import { appNavigation } from '../lib/navigation/navigation'
import { APP_ROUTES } from '../lib/navigation/routes'
import { useEditorInputStore } from './editor-input'
import { useHistoryStore } from './history'
import { useIpcStore } from './ipc'
import { useLlmStore } from './llm'
import { useMenuModalsStore } from './menu-modals'

/**
 * One chat: "Ask AI" when `profileId` is null, a profile chat otherwise. Each
 * has its own conversation, draft and history; nothing of one reaches the
 * other. A profile chat follows its `SOUL.md` and settings only: the
 * instructions and rules of "Ask AI" do not apply to it.
 */
function createChatStoreSetup(profileId: string | null) {
  return () => {
    const { storeChatImage, syncChatImages, loadChatWithImages } =
      createChatImageStorage({
        invoke: invokeDesktop,
        createId: () => crypto.randomUUID(),
        profileId: profileId ?? undefined,
      })
    const { toastKey, toastText } = useToast()
    const ipcStore = useIpcStore()
    const saveSessionState = ipcStore.patchSessionState
    const llmStore = useLlmStore()
    const { sendChatMessage, generateChatTitle } = llmStore.actions
    const aiProfilesStore = useAiProfilesStore()
    const editorInputStore = useEditorInputStore()
    const chatInputStore = profileId
      ? useProfileChatInputStore(profileId)
      : useChatInputStore()
    const menuModalsStore = useMenuModalsStore()
    const profileHistory = profileId
      ? createChatHistoryModel(
          createIpcChatSessionStorageDriver(ipcStore, profileId)
        )
      : null
    const history = profileHistory ?? useHistoryStore()

    const profile = computed(() =>
      profileId ? aiProfilesStore.getProfile(profileId) : undefined
    )
    /** The profile's root instruction as last read from `SOUL.md` */
    const soul = ref('')
    /** The chat to reopen; a profile chat remembers it while the app runs */
    const lastProfileChatId = ref<string | null>(null)

    /**
     * Reads `SOUL.md` and `profile.json` anew: the user may edit them by hand
     * between two requests
     */
    const refreshProfile = async () => {
      if (!profileId) return
      const [stored, content] = await Promise.all([
        aiProfilesStore.refreshProfile(profileId),
        aiProfilesStore.readSoul(profileId),
      ])
      soul.value = content
      return stored
    }

    let profileReady: Promise<void> | null = null
    /** The history and the root instruction a profile chat starts with */
    const prepareProfile = () => {
      profileReady ??= Promise.all([
        history.loadChatHistory(),
        refreshProfile(),
      ]).then(
        () => {},
        (error: unknown) => {
          profileReady = null
          clientLogger.warn(
            `Could not read the profile ${profileId}: ${String(error)}`,
            'chat'
          )
        }
      )
      return profileReady
    }

    const modelOptions = computed(() =>
      chatModelOptions(
        normalizeLlmConfig(ipcStore.desktopState.userConfig?.llm),
        (id) => isSecretUsable(llmStore.secrets, id)
      )
    )
    const selectedModel = computed<ChatLlmOption | null>(() => {
      if (!profileId) {
        return pickChatModel(
          modelOptions.value,
          ipcStore.desktopState.sessionState?.lastChatModelId
        )
      }
      const picked = pickChatModel(modelOptions.value, profile.value?.modelId)
      const cap = profile.value?.maxOutputTokens
      if (!picked || cap === undefined) return picked
      return {
        ...picked,
        maxOutputTokens: Math.min(picked.maxOutputTokens ?? cap, cap),
      }
    })

    const getChatInstructions = () =>
      profileId
        ? soul.value
        : (ipcStore.desktopState.appConfig ?? APP_CONFIG).aiInstructions[
            LlmInstructionKind.CHAT
          ]
    const getChatRules = () =>
      profileId ? undefined : ipcStore.desktopState.userConfig.aiRules?.chat
    const requestBudgetCharacters = () => {
      const picked = selectedModel.value
      if (!picked) return 0
      return chatRequestBudgetCharacters(picked, {
        instructions: getChatInstructions(),
        rules: getChatRules(),
        rulePrefix: (ipcStore.desktopState.appConfig ?? APP_CONFIG).rulePrefix,
      })
    }

    const debugToolProvider = createDebugChatToolProvider()
    const chatTools = createChatToolsSession({
      providers: () => (isDebugChatToolsEnabled() ? [debugToolProvider] : []),
      isDebugEnabled: () => isDebugChatToolsEnabled(),
      warn: (message) => clientLogger.warn(message, 'chat'),
    })
    onScopeDispose(chatTools.dispose)
    /** The tools of a turn on the model picked in the chat */
    const turnTools = async (
      modelId: string,
      profileTools?: ProfileToolSettings
    ) => {
      const canUseTools = selectedModel.value?.canUseTools ?? false
      return {
        canUseTools,
        tools: await chatTools.toolsFor({
          profileId,
          modelId,
          canUseTools,
          settings: profileTools,
        }),
      }
    }

    const model = createChatModel({
      sendChatMessage: async (message, prevMessages, instructions, options) => {
        if (!profileId) {
          return sendChatMessage(message, prevMessages, instructions, {
            ...options,
            ...(await turnTools(options.modelId)),
            rules: getChatRules(),
          })
        }
        const stored = await refreshProfile()
        return sendChatMessage(message, prevMessages, soul.value, {
          ...options,
          ...(await turnTools(options.modelId, stored?.tools)),
          temperature: stored?.temperature,
          maxOutputTokens: stored?.maxOutputTokens,
          loadImage: (id) => getChatImage(id, profileId),
        })
      },
      generateChatTitle,
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
      navigateTo: async (path) => {
        if (profileId && path === APP_ROUTES.CHAT.path) {
          const isShown =
            appNavigation.isCurrent(APP_ROUTES.CHAT.path) &&
            appNavigation.currentProfileId() === profileId
          if (!isShown) await appNavigation.goToProfileChat(profileId)
          return
        }
        await appNavigation.push(path)
      },
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
      createId: () => crypto.randomUUID(),
      nowIso: () => new Date().toISOString(),
      // which chat to reopen is a convenience: a failure is only logged
      saveSessionState: async (patch) => {
        if (profileId) {
          if (patch.lastChatId) lastProfileChatId.value = patch.lastChatId
          return
        }
        const result = await saveSessionState(patch)
        if (!result.success)
          clientLogger.warn(
            `Could not save the last chat: ${result.error}`,
            'chat'
          )
      },
      getLastChatId: () =>
        profileId
          ? (lastProfileChatId.value ??
            profileHistory?.chatHistory.value[0]?.id)
          : ipcStore.desktopState.sessionState?.lastChatId,
      isHistoryEnabled: () =>
        isChatHistoryEnabled(ipcStore.desktopState.userConfig),
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

    onScopeDispose(model.stopGeneration)
    // permissions given "for this session" end with the conversation
    watch(
      () => model.currentChatParams.value.id,
      () => chatTools.resetPermissions()
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
      getDraft: () => model.currentChatParams.value,
      getMessages: () => model.messages.value,
      getSavingImages: () => model.savingImages.value,
      isGenerating: () => model.isGenerating.value,
      prepare: createChatFileReader({
        quality: () =>
          ipcStore.desktopState.userConfig?.chat.imageQuality || 'balanced',
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
      reportSyncError: () => toastKey('chat.imageUnavailable', 'error'),
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
        if (profileId) {
          try {
            await aiProfilesStore.updateProfile(profileId, { modelId: id })
          } catch (error) {
            toastText(
              `${translate('toast.desktopCommandFailed')}: ${String(error)}`,
              'error'
            )
          }
          return
        }
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
    }
  }
}

/** "Ask AI": the chat the editor, the tools and the quick window talk to */
export const useChatStore = defineStore('chat', createChatStoreSetup(null))

export type ChatStore = ReturnType<typeof useChatStore>

const profileChatStores = new Map<string, typeof useChatStore>()

const profileChatStoreId = (profileId: string) => `chat-profile:${profileId}`

/** The chat of a profile; it lives on while the user is elsewhere */
export function useProfileChatStore(
  profileId: string,
  pinia?: Pinia
): ChatStore {
  let definition = profileChatStores.get(profileId)
  if (!definition) {
    definition = defineStore(
      profileChatStoreId(profileId),
      createChatStoreSetup(profileId)
    ) as unknown as typeof useChatStore
    profileChatStores.set(profileId, definition)
  }
  return definition(pinia)
}

/** Stops and forgets the chat of a removed profile */
export function disposeProfileChatStore(profileId: string, pinia?: Pinia) {
  const active = pinia ?? getActivePinia()
  const definition = profileChatStores.get(profileId)
  if (!active || !definition) return
  const id = profileChatStoreId(profileId)
  // a store only exists once something used it
  if (!(id in active.state.value)) return
  const store = definition(active)
  store.stopGeneration()
  store.$dispose()
  delete active.state.value[id]
}
