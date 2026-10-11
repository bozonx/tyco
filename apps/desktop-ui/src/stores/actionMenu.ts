import { defineStore } from 'pinia'
import { computed } from 'vue'

import {
  type ActionItem,
  createActionMenuStoreModel,
} from '../lib/action-menu/action-menu-store'
import { useInvocationRunnerDependencies } from './invocations'
import { useCorrectionStore } from './correction'
import { useHistoryStore } from './history'
import { useIpcStore } from './ipc'
import { MenuModals, useMenuModalsStore } from './menuModals'

export type { ActionItem }

export const useActionMenuStore = defineStore('actionMenu', () => {
  const ipcStore = useIpcStore()
  const menuModalsStore = useMenuModalsStore()
  const historyStore = useHistoryStore()
  const appConfig = computed(() => ipcStore.params.appConfig)
  const correctionStore = useCorrectionStore()

  return createActionMenuStoreModel({
    saveOutput: async (text: string) => {
      await historyStore.saveOutput(text)
    },
    openAiTaskModal: (text: string, taskId?: string) => {
      menuModalsStore.nextModal(MenuModals.AI_TASK, { text, taskId })
    },
    openTranslateModal: (text: string, language?: string) => {
      menuModalsStore.nextModal(MenuModals.TRANSLATE, { text, language })
    },
    startCorrection: (text: string, extra?: Record<string, unknown>) =>
      // the result replaces the text in the editor as well
      correctionStore.start(text, { toEditorVisible: true, ...extra }),
    minCorrectionLength: () => appConfig.value.minCorrectionLength,
    mainActionRegistrations: () =>
      ipcStore.params.userConfig.mainActionRegistrations,
    openLauncherPage: async (page, text) => {
      await ipcStore.callFunction('activateMode', [
        `commandLauncher${page + 1}`,
        text,
      ])
    },
    mainActions: () => ipcStore.params.userConfig.mainActions,
    commands: () => ipcStore.params.userConfig.commands,
    aiTasks: () => ipcStore.params.userConfig.aiTasks,
    ...useInvocationRunnerDependencies(),
  })
})
