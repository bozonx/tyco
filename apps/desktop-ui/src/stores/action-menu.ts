import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { APP_CONFIG } from '@tyco/shared'

import {
  type ActionItem,
  createActionMenuModel,
} from '../lib/action-menu/action-menu-model'
import { isMainActionVisible } from '../lib/action-menu/main-actions'
import { resultOrThrow } from '../lib/ipc/ipc-model'
import { clientLogger } from '../lib/logger'
import { useInvocationRunnerDependencies } from './invocations'
import { useCorrectionWorkflowStore } from './correction-workflow'
import { useHistoryStore } from './history'
import { useDesktopStore } from './desktop'
import { useIpcStore } from './ipc'
import { MenuModals, useMenuModalsStore } from './menu-modals'
import { useAiProfilesStore } from './ai-profiles'
import { useProfileChatStore } from './chat'
import { useVoiceReferenceStore } from './voice-reference'
import { useVoiceResultStore } from './voice-result'

export type { ActionItem }

export const useActionMenuStore = defineStore('actionMenu', () => {
  const desktopStore = useDesktopStore()
  const menuModalsStore = useMenuModalsStore()
  const historyStore = useHistoryStore()
  const correctionWorkflowStore = useCorrectionWorkflowStore()
  const aiProfilesStore = useAiProfilesStore()

  const pendingProfileId = ref<string | null>(null)
  const consumePendingProfileId = () => {
    const id = pendingProfileId.value
    pendingProfileId.value = null
    return id
  }

  const model = createActionMenuModel({
    activateMode: async (mode, profileId) => {
      pendingProfileId.value = profileId ?? null
      await useIpcStore().callOrNotify('activate_mode', { mode })
    },
    openVoiceInput: async (text) => {
      const nextActivationId = desktopStore.desktopState.activationId + 1
      useVoiceResultStore().step.resetResult()
      const result = await useIpcStore().callOrNotify('activate_mode', {
        mode: 'voice',
      })
      if (result.success) {
        useVoiceReferenceStore().offer(text, nextActivationId)
      }
    },
    canListen: () => Boolean(desktopStore.desktopState.canListen),
    saveOutput: async (text: string) => {
      await historyStore.saveOutput(text)
    },
    logRun: async (record) => {
      resultOrThrow(await useIpcStore().call('log_command_run', { record }))
    },
    reportError: (error) =>
      clientLogger.error('Could not log command run', error, 'action-menu'),
    setPendingModal: (params, owner) =>
      menuModalsStore.setPendingModal(params, owner),
    clearPendingModal: (owner) => menuModalsStore.clearPendingModal(owner),
    openTransformationModal: (text: string, transformationId?: string) => {
      menuModalsStore.nextModal(MenuModals.TRANSFORMATION, {
        text,
        transformationId,
      })
    },
    openQuickAiRequestModal: (
      text: string,
      inputMode: 'text' | 'voice' = 'text',
      profileId?: string | null
    ) => {
      menuModalsStore.nextModal(MenuModals.QUICK_AI_REQUEST, {
        text,
        inputMode,
        profileId: profileId ?? null,
      })
    },
    openVoiceCommandsModal: (text, inputMode) => {
      menuModalsStore.nextModal(MenuModals.VOICE_COMMANDS, {
        text: inputMode === 'selection' ? text : '',
        ...(inputMode === 'selection' &&
        !text &&
        model.takesText.value &&
        desktopStore.desktopState.mode === 'selectionActions'
          ? { selectionActivationId: desktopStore.desktopState.activationId }
          : {}),
      })
    },
    openStylingModal: (text: string, stylingId?: string) => {
      menuModalsStore.nextModal(MenuModals.STYLING, { text, stylingId })
    },
    openChatPromptsModal: (text: string) => {
      menuModalsStore.nextModal(MenuModals.CHAT_PROMPTS, { text })
    },
    openChatPrompt: (text, prompt, profileId) => {
      menuModalsStore.nextModal(MenuModals.QUICK_AI_REQUEST, {
        text,
        profileId,
        prompt,
      })
    },
    openFavoritesModal: () => {
      menuModalsStore.nextModal(MenuModals.FAVORITES, {})
    },
    openTranslateModal: (text: string, language?: string) => {
      menuModalsStore.nextModal(MenuModals.TRANSLATE, { text, language })
    },
    correctAndInsert: (text) => correctionWorkflowStore.correctAndInsert(text),
    startCorrection: (text, extra) =>
      // the result replaces the text in the editor as well
      correctionWorkflowStore.start(text, {
        isEditorButtonVisible: true,
        ...extra,
      }),
    minCorrectionLength: () => APP_CONFIG.minCorrectionLength,
    isMainActionVisible: (action) =>
      isMainActionVisible(action, desktopStore.userConfig.isInDevelopment),
    actionPages: () => desktopStore.userConfig.actionPages,
    commands: () => desktopStore.userConfig.commands,
    transformations: () => desktopStore.userConfig.transformations?.items,
    styling: () => desktopStore.userConfig.styling?.items,
    profiles: () => aiProfilesStore.profiles,
    connectedVaultIds: () => aiProfilesStore.connectedVaultIds,
    areProfilesLoaded: () => aiProfilesStore.isLoaded,
    chatPrompts: () => desktopStore.userConfig.chatPrompts?.items,
    openProfileChat: async (profileId, text) => {
      const profileChat = useProfileChatStore(profileId)
      await profileChat.attachToChat(text)
    },
    openActionPage: async (pageIndex, text) => {
      if (
        desktopStore.desktopState.mode === 'selectionActions' &&
        desktopStore.desktopState.isWindowShown
      ) {
        model.openPage(pageIndex)
      } else {
        await useIpcStore().callOrNotify('activate_mode', {
          mode: 'selectionActions',
          actionPageIndex: pageIndex,
          text: text ?? desktopStore.desktopState.selectedText ?? '',
        })
      }
    },
    ...useInvocationRunnerDependencies(),
  })

  watch(
    () =>
      [
        desktopStore.desktopState.activationId,
        desktopStore.desktopState.actionPageIndex,
      ] as const,
    ([id, index], previous) => {
      if (previous && id === previous[0] && index === previous[1]) return
      model.openPage(typeof index === 'number' ? index : 0)
    },
    { immediate: true }
  )

  return { ...model, consumePendingProfileId }
})
