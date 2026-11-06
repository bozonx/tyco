import { watch } from 'vue'
import { defineStore } from 'pinia'
import { APP_CONFIG } from '@tyco/shared'

import {
  type ActionItem,
  createActionMenuModel,
} from '../lib/action-menu/action-menu-model'
import { isMainActionVisible } from '../lib/action-menu/main-actions'
import { useInvocationRunnerDependencies } from './invocations'
import { useCorrectionWorkflowStore } from './correction-workflow'
import { useHistoryStore } from './history'
import { useDesktopStore } from './desktop'
import { useIpcStore } from './ipc'
import { MenuModals, useMenuModalsStore } from './menu-modals'
import { useAiProfilesStore } from './ai-profiles'
import { useProfileChatStore } from './chat'

export type { ActionItem }

export const useActionMenuStore = defineStore('actionMenu', () => {
  const desktopStore = useDesktopStore()
  const menuModalsStore = useMenuModalsStore()
  const historyStore = useHistoryStore()
  const correctionWorkflowStore = useCorrectionWorkflowStore()
  const aiProfilesStore = useAiProfilesStore()

  const model = createActionMenuModel({
    activateMode: async (mode) => {
      await useIpcStore().callOrNotify('activate_mode', { mode })
    },
    saveOutput: async (text: string) => {
      await historyStore.saveOutput(text)
    },
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
      inputMode: 'text' | 'voice' = 'text'
    ) => {
      menuModalsStore.nextModal(MenuModals.QUICK_AI_REQUEST, {
        text,
        inputMode,
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
    openChatPromptsModal: (text: string, promptId?: string) => {
      menuModalsStore.nextModal(MenuModals.CHAT_PROMPTS, { text, promptId })
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
    openProfileChat: async (profileId, text) => {
      const profileChat = useProfileChatStore(profileId)
      await profileChat.attachToChat(text)
    },
    ...useInvocationRunnerDependencies(),
  })

  watch(
    () => desktopStore.desktopState.actionPageIndex,
    (index) => {
      if (typeof index === 'number') {
        model.setPage(index)
      }
    },
    { immediate: true }
  )

  return model
})
