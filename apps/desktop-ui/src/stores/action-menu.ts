import { defineStore } from 'pinia'
import { computed } from 'vue'

import {
  type ActionItem,
  createActionMenuModel,
} from '../lib/action-menu/action-menu-model'
import { useInvocationRunnerDependencies } from './invocations'
import { useCorrectionWorkflowStore } from './correction-workflow'
import { useHistoryStore } from './history'
import { useIpcStore } from './ipc'
import { MenuModals, useMenuModalsStore } from './menu-modals'

export type { ActionItem }

export const useActionMenuStore = defineStore('actionMenu', () => {
  const ipcStore = useIpcStore()
  const menuModalsStore = useMenuModalsStore()
  const historyStore = useHistoryStore()
  const appConfig = computed(() => ipcStore.desktopState.appConfig)
  const correctionWorkflowStore = useCorrectionWorkflowStore()

  return createActionMenuModel({
    saveOutput: async (text: string) => {
      await historyStore.saveOutput(text)
    },
    openAiTaskModal: (text: string, taskId?: string) => {
      menuModalsStore.nextModal(MenuModals.AI_TASK, { text, taskId })
    },
    openTranslateModal: (text: string, language?: string) => {
      menuModalsStore.nextModal(MenuModals.TRANSLATE, { text, language })
    },
    startCorrection: (text, extra) =>
      // the result replaces the text in the editor as well
      correctionWorkflowStore.start(text, {
        isEditorButtonVisible: true,
        ...extra,
      }),
    minCorrectionLength: () => appConfig.value.minCorrectionLength,
    reviewedMainActionIds: () =>
      ipcStore.desktopState.userConfig.registrationState?.reviewedMainActionIds,
    openLauncherPage: async (page, text) => {
      await ipcStore.callFunction('activateMode', [
        `commandLauncher${page + 1}`,
        text,
      ])
    },
    mainActions: () => ipcStore.desktopState.userConfig.mainActions,
    commands: () => ipcStore.desktopState.userConfig.commands,
    aiTasks: () => ipcStore.desktopState.userConfig.aiTasks,
    ...useInvocationRunnerDependencies(),
  })
})
